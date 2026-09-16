import { supabase } from '@/lib/supabase'

export const DOCUMENTS_BUCKET = 'documents'

export type DocumentOwnerType = 'vehicle' | 'driver' | 'trip' | 'business'

/** 10 MB, matching the bucket's own file_size_limit. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

export const ACCEPTED_UPLOAD_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
]

/**
 * Builds the object path.
 *
 * The leading segment is the business id, and the storage policies check
 * exactly that — so the path is the tenancy boundary, not a convention. Getting
 * it wrong means the upload is refused rather than landing somewhere shared.
 */
function objectPath(
  businessId: string,
  ownerType: DocumentOwnerType,
  ownerId: string,
  filename: string,
): string {
  // Object keys allow a narrow character set; a phone camera filename can
  // contain spaces and colons, so it is normalised rather than trusted.
  const safe = filename
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .slice(-80)
  return `${businessId}/${ownerType}/${ownerId}/${Date.now()}-${safe}`
}

export interface UploadResult {
  path: string
  documentId: string
}

/**
 * Uploads a file and records its metadata.
 *
 * The returned `path` is a storage key, not a URL: the bucket is private, so a
 * viewable link has to be signed at read time (see signedUrl below). Storing a
 * signed URL would leave a link in the database that expires.
 */
export async function uploadDocument(params: {
  businessId: string
  ownerType: DocumentOwnerType
  ownerId: string
  docType: string
  file: File
}): Promise<UploadResult> {
  const { businessId, ownerType, ownerId, docType, file } = params

  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error('That file is larger than 10 MB. Try a smaller photo.')
  }
  if (file.type && !ACCEPTED_UPLOAD_TYPES.includes(file.type)) {
    throw new Error('Only JPG, PNG, WebP, HEIC and PDF files can be attached.')
  }

  const path = objectPath(businessId, ownerType, ownerId, file.name)

  const { error: uploadError } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(path, file, { contentType: file.type || undefined, upsert: false })

  if (uploadError) throw uploadError

  const { data, error } = await supabase
    .from('documents')
    .insert({
      business_id: businessId,
      owner_type: ownerType,
      owner_id: ownerId,
      file_url: path,
      doc_type: docType,
    })
    .select('id')
    .single()

  if (error) {
    // The row is what makes the object findable, so an orphaned object is
    // removed rather than left paying for storage nobody can reach.
    await supabase.storage.from(DOCUMENTS_BUCKET).remove([path])
    throw error
  }

  return { path, documentId: data.id }
}

export interface StoredDocument {
  id: string
  business_id: string
  owner_type: DocumentOwnerType
  owner_id: string
  file_url: string
  doc_type: string | null
  created_at: string
}

export async function listDocuments(
  businessId: string,
  ownerType: DocumentOwnerType,
  ownerId: string,
): Promise<StoredDocument[]> {
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('business_id', businessId)
    .eq('owner_type', ownerType)
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data ?? []
}

/** A short-lived link for viewing a private object. */
export async function signedUrl(path: string, expiresInSeconds = 300): Promise<string> {
  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(path, expiresInSeconds)

  if (error) throw error
  return data.signedUrl
}

export async function deleteDocument(document: StoredDocument): Promise<void> {
  // The object goes first: a failure there leaves a findable row, which is
  // recoverable. The other order leaves a file nobody can see or remove.
  const { error: storageError } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .remove([document.file_url])
  if (storageError) throw storageError

  const { error } = await supabase.from('documents').delete().eq('id', document.id)
  if (error) throw error
}

/**
 * Uploads a delivery photo for a driver, and nothing else.
 *
 * Separate from uploadDocument because a driver cannot write the documents
 * table — the driver migration fences them out of it. The metadata row is
 * written server-side by driver_attach_pod(), which re-checks that the file
 * landed in this business's folder before it records anything.
 *
 * Returns the storage path, which is what the RPC wants.
 */
export async function uploadTripPhoto(params: {
  businessId: string
  tripId: string
  file: File
}): Promise<string> {
  const { businessId, tripId, file } = params
  const path = objectPath(businessId, 'trip', tripId, file.name)

  const { error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(path, file, { contentType: file.type || undefined, upsert: false })

  if (error) throw error
  return path
}
