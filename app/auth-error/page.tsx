import Link from "next/link";

export default function AuthErrorPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500">
      <div className="w-full max-w-md rounded-2xl bg-white p-10 shadow-2xl">
        <div className="flex flex-col items-center text-center">
          <svg className="h-16 w-16" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="16" cy="16" r="5" fill="#7c3aed" />
            <circle cx="16" cy="16" r="9" stroke="#7c3aed" strokeWidth="1.5" opacity="0.6" />
            <circle cx="16" cy="16" r="13" stroke="#7c3aed" strokeWidth="1.5" opacity="0.3" />
          </svg>
          <h1 className="mt-4 text-3xl font-bold text-gray-900">Pulsar</h1>
          <h2 className="mt-4 text-lg font-semibold text-gray-900">Access Denied</h2>
          <p className="mt-2 text-sm text-gray-500">
            Your account is not authorized to access Pulsar. Please contact an administrator if you believe this is an error.
          </p>
          <Link
            href="/login"
            className="mt-8 flex w-full items-center justify-center rounded-lg bg-indigo-600 px-4 py-3 font-medium text-white transition hover:bg-indigo-700"
          >
            Login
          </Link>
        </div>
      </div>
    </div>
  );
}
