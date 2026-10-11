'use client';

/** Last-resort boundary: replaces the root layout, so it must render <html>/<body> itself. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="fa" dir="rtl">
      <body style={{ fontFamily: 'Tahoma, Arial, sans-serif', margin: 0, background: '#fafafc', color: '#1c1b22' }}>
        <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center' }}>
          <div>
            <h1 style={{ fontSize: 24, marginBottom: 8 }}>خطای غیرمنتظره</h1>
            <p style={{ color: '#5b586a', marginBottom: 16 }}>
              متأسفیم، مشکلی پیش آمد. لطفاً دوباره تلاش کنید.
              {error.digest ? ` (کد پیگیری: ${error.digest})` : null}
            </p>
            <button
              onClick={reset}
              style={{ background: '#6d28d9', color: '#fff', border: 0, borderRadius: 10, padding: '10px 24px', fontSize: 15, cursor: 'pointer' }}
            >
              تلاش دوباره
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
