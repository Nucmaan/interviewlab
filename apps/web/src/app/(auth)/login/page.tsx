import { redirect } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getCurrentUser } from '@/lib/rbac';
import { LoginForm } from '@/modules/users/components/login-form';

export const metadata = { title: 'Sign in' };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect('/');
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl">IRCUB</CardTitle>
          <CardDescription>
            Integrated Revenue Collection &amp; Utility Billing Platform
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm />
          <p className="mt-6 text-xs text-muted-foreground">
            Evaluation environment with fictional test data only. Demo accounts are listed in the
            README.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
