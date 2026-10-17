import { CircleAlert } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

/** Form-level error (shown above the submit button). Renders nothing when `message` is empty. */
export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <Alert variant="destructive">
      <CircleAlert />
      <AlertDescription className="text-foreground">{message}</AlertDescription>
    </Alert>
  );
}
