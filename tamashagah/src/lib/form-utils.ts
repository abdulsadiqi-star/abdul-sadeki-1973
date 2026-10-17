import type { FieldValues, Path, UseFormReturn } from 'react-hook-form';
import type { ActionFailure } from '@/lib/errors';

/**
 * Push a failed Server Action result into a react-hook-form instance.
 * Field errors are attached to their inputs; the returned string (if any) is a
 * form-level message that should be shown in an <Alert>.
 *
 *   const res = await loginAction(values);
 *   if (!res.ok) { setFormError(applyServerErrors(form, res)); return; }
 */
export function applyServerErrors<T extends FieldValues>(form: UseFormReturn<T>, failure: ActionFailure): string | null {
  const fieldErrors = failure.fieldErrors ?? {};
  let formMessage: string | null = null;
  let attached = 0;
  for (const [name, messages] of Object.entries(fieldErrors)) {
    const first = messages[0];
    if (!first) continue;
    if (name === '_form') {
      formMessage = first;
      continue;
    }
    form.setError(name as Path<T>, { type: 'server', message: first });
    attached++;
  }
  if (!formMessage && (attached === 0 || failure.code !== 'VALIDATION')) formMessage = failure.message;
  return formMessage;
}
