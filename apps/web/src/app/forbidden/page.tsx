import Link from 'next/link';

export const metadata = { title: 'Not allowed' };

export default function ForbiddenPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold">You do not have access to this page</h1>
      <p className="text-muted-foreground">
        Your role does not include the permission needed here. If you need it for your work, ask a
        System Administrator.
      </p>
      <Link className="text-primary underline" href="/">
        Back to my home page
      </Link>
    </main>
  );
}
