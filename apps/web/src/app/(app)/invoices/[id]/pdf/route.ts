import { ApiError, createApiClient } from '@/lib/api';
import { getToken } from '@/lib/session';

/**
 * The invoice PDF, proxied through the app.
 *
 * The API authenticates with a bearer token that lives in an httpOnly cookie, so
 * the browser cannot ask for the PDF itself — it would arrive without the
 * Authorization header and be refused. Streaming it through here keeps the token
 * server-side and still gives the operator a real download with the right
 * filename and content type.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const token = await getToken();

  if (!token) {
    return Response.json(
      { statusCode: 401, code: 'UNAUTHENTICATED', message: 'Sign in to download this invoice.' },
      { status: 401 },
    );
  }

  try {
    const upstream = await createApiClient(token).raw(`/invoices/${id}/pdf`);

    if (!upstream.ok || !upstream.body) {
      return Response.json(
        {
          statusCode: upstream.status,
          code: 'PDF_UNAVAILABLE',
          message: `The API returned ${upstream.status} instead of a PDF.`,
        },
        { status: upstream.status === 200 ? 502 : upstream.status },
      );
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        'content-type': upstream.headers.get('content-type') ?? 'application/pdf',
        // `inline` so the browser's own PDF viewer opens it, which is what an
        // operator wants before deciding to send it; the viewer can still save.
        'content-disposition': `inline; filename="invoice-${id}.pdf"`,
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    const problem = error instanceof ApiError ? error.problem : undefined;
    return Response.json(
      problem ?? { statusCode: 502, code: 'PDF_UNAVAILABLE', message: 'The PDF could not be fetched.' },
      { status: problem?.statusCode || 502 },
    );
  }
}
