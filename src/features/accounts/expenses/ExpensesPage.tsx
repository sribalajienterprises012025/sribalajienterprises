import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useBusinessId, useCanEdit } from '@/hooks/useAuth'
import { useMasterData } from '@/hooks/useMasterData'
import { useToast } from '@/hooks/useToast'
import { describeError } from '@/lib/supabase'
import { formatCurrency, formatDateShort, humanize } from '@/lib/format'
import { queryKeys } from '@/lib/queries/keys'
import {
  createExpense,
  deleteExpense,
  listExpenses,
  updateExpense,
  type ExpenseFilters,
  type ExpenseInput,
} from '@/lib/queries/expenses'
import type { Expense, ExpenseCategory, ExpenseWithRelations } from '@/types'
import { ExpenseForm } from './ExpenseForm'
import { EXPENSE_CATEGORIES } from './categories'

/** yyyy-MM-01 for the current month — the default range for the expense list. */
function startOfThisMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

export function ExpensesPage() {
  const businessId = useBusinessId()
  const canEdit = useCanEdit()
  const toast = useToast()
  const queryClient = useQueryClient()
  const { vehicles } = useMasterData()

  const [category, setCategory] = useState<ExpenseCategory | 'all'>('all')
  const [from, setFrom] = useState(startOfThisMonth())
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Expense | null>(null)
  const [deleting, setDeleting] = useState<ExpenseWithRelations | null>(null)

  const filters = useMemo<ExpenseFilters>(() => ({ category, from }), [category, from])

  const expensesQuery = useQuery({
    queryKey: queryKeys.expenses(businessId, filters),
    queryFn: () => listExpenses(businessId, filters),
  })

  const total = useMemo(
    () => (expensesQuery.data ?? []).reduce((sum, expense) => sum + expense.amount, 0),
    [expensesQuery.data],
  )

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['expenses'] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(businessId) }),
    ])
  }

  const saveMutation = useMutation({
    mutationFn: (input: ExpenseInput) =>
      editing ? updateExpense(editing.id, input) : createExpense(businessId, input),
    onSuccess: async () => {
      await invalidate()
      toast.success(editing ? 'Expense updated' : 'Expense added')
      setFormOpen(false)
      setEditing(null)
    },
    onError: (error) => toast.error(describeError(error)),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteExpense(id),
    onSuccess: async () => {
      await invalidate()
      toast.success('Expense deleted')
      setDeleting(null)
    },
    onError: (error) => toast.error(describeError(error)),
  })

  const openCreate = () => {
    setEditing(null)
    setFormOpen(true)
  }

  return (
    <>
      <PageHeader
        title="Expenses"
        subtitle={`${formatCurrency(total)} in the selected period`}
        action={
          canEdit ? (
            <Button size="sm" onClick={openCreate}>
              Add
            </Button>
          ) : undefined
        }
      />

      <div className="space-y-3 px-4 lg:px-6">
        <div className="flex gap-2">
          <select
            value={category}
            onChange={(event) =>
              setCategory(event.target.value as ExpenseCategory | 'all')
            }
            className="min-h-[44px] flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-brand-500"
          >
            <option value="all">All categories</option>
            {EXPENSE_CATEGORIES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>

          <input
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            aria-label="Show expenses from"
            className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-brand-500"
          />
        </div>

        {expensesQuery.isPending ? (
          <LoadingState label="Loading expenses…" />
        ) : expensesQuery.isError ? (
          <ErrorState
            error={expensesQuery.error}
            onRetry={() => void expensesQuery.refetch()}
          />
        ) : expensesQuery.data.length === 0 ? (
          <EmptyState
            icon="💰"
            title="Nothing recorded here"
            description="Log diesel, tolls, batta and repairs as they happen so the monthly picture stays accurate."
            action={canEdit ? <Button onClick={openCreate}>Add an expense</Button> : undefined}
          />
        ) : (
          <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {expensesQuery.data.map((expense) => (
              <div key={expense.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">
                      {humanize(expense.category)}
                    </p>
                    <p className="mt-0.5 truncate text-sm text-slate-500">
                      {formatDateShort(expense.date)}
                      {expense.vehicle && ` · ${expense.vehicle.reg_no}`}
                      {` · ${humanize(expense.payment_mode)}`}
                    </p>
                    {expense.note && (
                      <p className="mt-1 truncate text-xs text-slate-400">{expense.note}</p>
                    )}
                  </div>
                  <p className="shrink-0 font-semibold text-slate-900">
                    {formatCurrency(expense.amount)}
                  </p>
                </div>

                {canEdit && (
                  <div className="mt-2.5 flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setEditing(expense)
                        setFormOpen(true)
                      }}
                    >
                      Edit
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setDeleting(expense)}>
                      Delete
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {formOpen && (
        <ExpenseForm
          key={editing?.id ?? 'new'}
          open={formOpen}
          expense={editing}
          vehicles={vehicles}
          saving={saveMutation.isPending}
          onClose={() => {
            setFormOpen(false)
            setEditing(null)
          }}
          onSubmit={(values) => saveMutation.mutate(values)}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete expense"
        message={
          deleting
            ? `Delete the ${formatCurrency(deleting.amount)} ${humanize(deleting.category).toLowerCase()} entry?`
            : ''
        }
        loading={deleteMutation.isPending}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
        onCancel={() => setDeleting(null)}
      />
    </>
  )
}
