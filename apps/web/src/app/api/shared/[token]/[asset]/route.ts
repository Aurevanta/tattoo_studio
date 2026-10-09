import { errorResponse, RequestError, sharedWorker } from '../../../../../lib/studio-server';

/**
 * One file of a design shared with a tattooer (TASK-0097, ADR-0032). The worker decides which
 * files the link opens; this only passes them on. Served as inert content: a stencil is opened
 * or downloaded, never run.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string; asset: string }> },
): Promise<Response> {
  try {
    const { token, asset } = await params;
    if (!/^[a-f0-9]{32}$/.test(asset)) throw new RequestError('Archivo no disponible.', 404);
    const response = await sharedWorker(token, `/media/${asset}`);
    return new Response(response.body, {
      headers: {
        'Content-Type': response.headers.get('content-type') ?? 'application/octet-stream',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        'Referrer-Policy': 'no-referrer',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
