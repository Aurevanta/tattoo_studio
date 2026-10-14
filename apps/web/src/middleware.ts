import { NextResponse, type NextRequest } from 'next/server';

/**
 * Keeps strangers off the studio's pages (TASK-0045, ADR-0021).
 *
 * This is a cheap gate, not the security boundary: it only looks for a session cookie, so it costs
 * no network call and adds no latency to a page load. Anyone can forge a cookie and get the HTML
 * shell, which is why **every API route verifies the account properly with Supabase**. That is
 * where money is spent and stored work is read, and that is where the real check belongs.
 *
 * Its job is narrower and still worth doing: a visitor who is not signed in lands on the sign-in
 * page instead of a studio that fails on every action.
 */
export function middleware(request: NextRequest): NextResponse {
  const signedIn = request.cookies.has('inkcraft_at') || request.cookies.has('inkcraft_rt');
  if (signedIn) return NextResponse.next();

  const url = request.nextUrl.clone();
  // TASK-0096 (audit 2026-10-08 UX-01): a stranger at the front door sees what the studio makes.
  url.pathname = request.nextUrl.pathname === '/' ? '/inicio' : '/entrar';
  url.search = '';
  return NextResponse.redirect(url);
}

export const config = {
  /*
   * Pages only. `/api` is excluded because those routes answer with 401 rather than a redirect —
   * a fetch that receives login HTML instead of JSON is a confusing failure. `/entrar` is excluded
   * for the obvious reason, and the PWA's own files so an installed app can still start and show
   * the sign-in page offline. `brand` holds the background and the logo the sign-in page itself
   * shows, so it has to load before anyone is signed in (TASK-0048). The terms and the privacy
   * policy are read before signing in too (TASK-0064), and crawlers read `robots.txt` and
   * `sitemap.xml` (TASK-0093). The landing and its example images are public (TASK-0096), and so is a link a client gave
   * their tattooer, `/t/<token>` (TASK-0097).
   */
  matcher: [
    '/((?!api|inicio|ejemplos/|models/|t/|entrar|recuperar|restablecer|condiciones|privacidad|robots.txt|sitemap.xml|_next|icons|brand/|sw.js|manifest.webmanifest|favicon.ico).*)',
  ],
};
