export { auth as middleware } from "@/lib/auth";

export const config = {
  matcher: [
    "/((?!login|auth-error|api/auth|_next/static|_next/image|favicon.ico).*)",
  ],
};
