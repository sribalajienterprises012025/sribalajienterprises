import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Field } from '@/components/ui/Field'
import { controlClass } from '@/components/ui/control'
import { Sheet } from '@/components/ui/Sheet'
import { LoadingState } from '@/components/ui/States'
import { useBusinessId, useCanEdit, useIsOwner } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import { describeError } from '@/lib/supabase'
import { formatDate } from '@/lib/format'
import {
  deleteDocument,
  listDocuments,
  signedUrl,
  uploadDocument,
  type DocumentOwnerType,
  type StoredDocument,
} from '@/lib/storage'

/** Document kinds worth naming, per owner, so the list stays searchable. */
const DOC_TYPES: Record<DocumentOwnerType, string[]> = {
  trip: ['Proof of delivery', 'LR copy', 'E-way bill', 'Weighment slip', 'Other'],
  vehicle: ['RC', 'Insurance', 'Permit', 'Fitness', 'PUC', 'Invoice', 'Other'],
  driver: ['Licence', 'Aadhaar', 'Police verification', 'Other'],
  business: ['GST certificate', 'PAN', 'Bank proof', 'Other'],
}

/**
 * Attachments for a trip, vehicle, driver or the business.
 *
 * Files live in the private `documents` bucket under a path that begins with
 * the business id, which is what the storage policies check — so a viewable
 * link has to be signed on demand rather than stored.
 */
export function DocumentsSheet({
  ownerType,
  ownerId,
  title,
  /** Called with the newest file's path, for owners that cache one (trips). */
  onPrimaryChange,
  onClose,
}: {
  ownerType: DocumentOwnerType
  ownerId: string
  title: string
  onPrimaryChange?: (path: string | null) => void | Promise<void>
  onClose: () => void
}) {
  const businessId = useBusinessId()
  const canEdit = useCanEdit()
  const isOwner = useIsOwner()
  const toast = useToast()
  const queryClient = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)

  const [docType, setDocType] = useState(DOC_TYPES[ownerType][0] ?? 'Other')
  const [opening, setOpening] = useState<string | null>(null)

  const queryKey = ['documents', businessId, ownerType, ownerId]

  const documentsQuery = useQuery({
    queryKey,
    queryFn: () => listDocuments(businessId, ownerType, ownerId),
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey })

  const uploadMutation = useMutation({
    mutationFn: (file: File) =>
      uploadDocument({ businessId, ownerType, ownerId, docType, file }),
    onSuccess: async (result) => {
      await refresh()
      await onPrimaryChange?.(result.path)
      toast.success('File attached')
      if (fileInput.current) fileInput.current.value = ''
    },
    onError: (error) => toast.error(describeError(error)),
  })

  const deleteMutation = useMutation({
    mutationFn: (document: StoredDocument) => deleteDocument(document),
    onSuccess: async (_result, document) => {
      await refresh()
      const remaining = (documentsQuery.data ?? []).filter(
        (item) => item.id !== document.id,
      )
      await onPrimaryChange?.(remaining[0]?.file_url ?? null)
      toast.success('File removed')
    },
    onError: (error) => toast.error(describeError(error)),
  })

  /** Signed on click, because a stored link would already have expired. */
  async function open(document: StoredDocument) {
    setOpening(document.id)
    try {
      const url = await signedUrl(document.file_url)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (error) {
      toast.error(describeError(error))
    } finally {
      setOpening(null)
    }
  }

  return (
    <Sheet open onClose={onClose} title={title}>
      <div className="space-y-4">
        {documentsQuery.isPending ? (
          <LoadingState label="Loading files…" />
        ) : (documentsQuery.data?.length ?? 0) === 0 ? (
          <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">
            Nothing attached yet.
          </p>
        ) : (
          <div className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
            {documentsQuery.data?.map((document) => (
              <div key={document.id} className="flex items-center justify-between gap-3 p-3">
                <button
                  type="button"
                  onClick={() => void open(document)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="truncate text-sm font-medium text-brand-700">
                    {document.doc_type ?? 'File'}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {formatDate(document.created_at)}
                    {opening === document.id && ' · opening…'}
                  </p>
                </button>
                {isOwner && (
                  <button
                    type="button"
                    onClick={() => deleteMutation.mutate(document)}
                    disabled={deleteMutation.isPending}
                    className="shrink-0 text-xs font-medium text-slate-400 hover:text-red-600 disabled:opacity-50"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {canEdit && (
          <div className="space-y-3 rounded-lg border border-slate-200 p-3">
            <Field label="What is this?" htmlFor="doc_type">
              <select
                id="doc_type"
                value={docType}
                onChange={(event) => setDocType(event.target.value)}
                className={controlClass()}
              >
                {(DOC_TYPES[ownerType] ?? ['Other']).map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </Field>

            <input
              ref={fileInput}
              type="file"
              // capture lets a phone go straight to the camera, which is how a
              // proof of delivery actually gets captured — at the drop point.
              accept="image/*,application/pdf"
              capture={ownerType === 'trip' ? 'environment' : undefined}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) uploadMutation.mutate(file)
              }}
              className="block w-full text-sm text-slate-600 file:mr-3 file:min-h-[40px] file:rounded-lg file:border-0 file:bg-brand-600 file:px-4 file:text-sm file:font-medium file:text-white"
            />

            {uploadMutation.isPending && (
              <p className="text-xs text-slate-500">Uploading…</p>
            )}

            <p className="text-xs text-slate-400">
              JPG, PNG, HEIC or PDF, up to 10 MB. Files are private to this business.
            </p>
          </div>
        )}
      </div>
    </Sheet>
  )
}
