'use client';

/**
 * Client component 1 of 2.
 *
 * Wraps a server action in a form and renders whatever `Problem` came back.
 * Errors are returned from the action rather than thrown, so the server's own
 * message — and its per-field detail — survives to the screen instead of being
 * redacted to "Something went wrong" at the RSC boundary.
 *
 * The alternative was a bare `<form action={serverAction}>` in each server
 * component, which works without JavaScript but has nowhere to put a failure.
 * One client component here costs a few hundred bytes and gives every form in
 * the app the same behaviour, including the `STALE_WRITE` reload prompt.
 */

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { isStaleWrite, type ActionState } from '@/lib/action-state';

export type FormAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * The submit control.
 *
 * `useFormStatus` only reports the status of the nearest enclosing `<form>`, so
 * this has to be a child of the form rather than a sibling — which is why it
 * lives here with the form rather than being passed in.
 */
function SubmitButton({
  label,
  pendingLabel,
  className,
  confirmText,
  name,
  value,
}: {
  label: string;
  pendingLabel: string;
  className: string;
  confirmText?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={className}
      disabled={pending}
      aria-busy={pending}
      {...(name ? { name } : {})}
      {...(value ? { value } : {})}
      {...(confirmText
        ? {
            onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
              if (!window.confirm(confirmText)) event.preventDefault();
            },
          }
        : {})}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

/**
 * A failed submit.
 *
 * `STALE_WRITE` is called out separately because it is not the operator's fault
 * and cannot be fixed by editing the form: the record moved on under them, and
 * the only safe action is to look at the current version before writing again.
 * Saving over it silently is precisely the bug the version check exists to stop.
 */
function ProblemBox({ problem, reloadHref }: { problem: NonNullable<ActionState> & { ok: false }; reloadHref?: string }) {
  const router = useRouter();
  const stale = isStaleWrite(problem.problem);
  const fields = Object.entries(problem.problem.fields ?? {});

  return (
    <div
      className={`rounded-md border px-3 py-2 text-xs ${
        stale ? 'border-[#4a3a14] bg-warn-wash text-warn' : 'border-[#4d2229] bg-bad-wash text-bad'
      }`}
      role="alert"
    >
      <p className="font-semibold">{stale ? 'This record changed while you were editing it' : 'Could not save'}</p>
      <p className="mt-1 opacity-90">{problem.problem.message}</p>

      {fields.length > 0 && (
        <ul className="mt-2 space-y-0.5 opacity-90">
          {fields.map(([field, message]) => (
            <li key={field}>
              <span className="font-medium">{field}</span>: {message}
            </li>
          ))}
        </ul>
      )}

      {stale && (
        <div className="mt-2 flex items-center gap-2">
          <button type="button" className="btn btn-sm" onClick={() => router.refresh()}>
            Load the current version
          </button>
          {reloadHref && (
            <a className="btn btn-sm" href={reloadHref}>
              Reload the page
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export function ActionForm({
  action,
  children,
  submitLabel = 'Save',
  pendingLabel,
  submitClassName = 'btn btn-primary',
  className = 'space-y-3',
  footer,
  confirmText,
  encType,
  reloadHref,
  hiddenValues,
  submitName,
  submitValue,
}: {
  action: FormAction;
  children?: ReactNode;
  submitLabel?: string;
  pendingLabel?: string;
  submitClassName?: string;
  className?: string;
  footer?: ReactNode;
  confirmText?: string;
  encType?: string;
  /** Where "reload" should go when the write lost a race. */
  reloadHref?: string;
  hiddenValues?: Record<string, string | undefined>;
  /**
   * Names the primary button, so one form can offer several outcomes — the
   * public quote page submits accept or decline from the same form and lets the
   * button that was pressed decide which.
   */
  submitName?: string;
  submitValue?: string;
}) {
  const [state, formAction] = useActionState(action, null);

  return (
    <form action={formAction} className={className} {...(encType ? { encType } : {})}>
      {hiddenValues &&
        Object.entries(hiddenValues).map(([name, value]) =>
          value === undefined ? null : <input key={name} type="hidden" name={name} value={value} />,
        )}

      {children}

      {state && !state.ok && <ProblemBox problem={state} reloadHref={reloadHref} />}
      {state?.ok && state.message && (
        <p className="rounded-md border border-[#1d4530] bg-ok-wash px-3 py-2 text-xs font-medium text-ok" role="status">
          {state.message}
        </p>
      )}

      <div className="flex items-center gap-2">
        <SubmitButton
          label={submitLabel}
          pendingLabel={pendingLabel ?? `${submitLabel}…`}
          className={submitClassName}
          {...(confirmText ? { confirmText } : {})}
          {...(submitName ? { name: submitName } : {})}
          {...(submitValue ? { value: submitValue } : {})}
        />
        {footer}
      </div>
    </form>
  );
}

/**
 * The same pending behaviour for a form that is not an `ActionForm`.
 *
 * The quote builder owns its own `<form>` because it has to serialise client
 * state into a hidden field, but it still wants a button that knows when the
 * write is in flight.
 */
export function InlineSubmit({
  label,
  pendingLabel,
  className = 'btn btn-primary',
  disabled,
  confirmText,
  name,
  value,
}: {
  label: string;
  pendingLabel: string;
  className?: string;
  disabled?: boolean;
  confirmText?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={className}
      disabled={pending || disabled}
      aria-busy={pending}
      {...(name ? { name } : {})}
      {...(value ? { value } : {})}
      {...(confirmText
        ? {
            onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
              if (!window.confirm(confirmText)) event.preventDefault();
            },
          }
        : {})}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

export { ProblemBox };
