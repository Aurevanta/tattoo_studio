---
type: adr
status: accepted
id: ADR-0032
created: 2026-10-09
---

# ADR-0032: A client shares a design with their tattooer through a link

## Context

The external audit of 2026-10-08 (UX-05) found the product's key moment — taking the design to the
tattooer — outside the app: only loose downloads, without the measurements, the zone or the
professional description, and a competitor sells exactly that bundle. The owner asked for «paquete
para el tatuador». Everything in the studio was private to its account (ADR-0021); nothing could be
opened without signing in.

## Decision

1. **A link per design, made by its owner.** «Compartir con mi tatuador» in the result creates a
   link `/t/<token>` to one finished version. Anyone holding the link opens it without an account.
   Several links may exist; «Dejar de compartir» closes every link to that design.
2. **What it shows is fixed by a contract.** `shared-design.schema.json`: the design, the stencil
   and its mirror (SVG and PDF, with the A4 pieces of TASK-0088), the measurements, the zone and
   side, the style, the colour mode and palette, the client's idea, the professional description,
   how the stencil was obtained (TASK-0086), and «a professional reviews it». Never a photograph
   of the client's body, a view composed on it, a camera capture, the body type or the account.
   The view on the skin is shared only when it was composed on a generated skin plate.
3. **The worker decides, from the stored job.** It builds the shared view each time from the job and
   validates it against the contract; it serves only that view's files. A version that is gone, or
   whose files are gone, closes its links.
4. **The token is a capability, kept as a digest.** 24 random bytes (URL-safe base64). The worker
   stores only its SHA-256, so a copy of the database opens nothing. The web passes the token to
   the worker in `X-Share-Token`, never in the worker's path, with the service token alone. The
   public page is `noindex`, sends no referrer, and is outside the page gate.
5. **It ends.** After 30 days, when the client withdraws it, or when the account is erased. An
   account holds at most 20 open links. Creating a link requires the current consent.
6. **Said where it is done, and in the policy.** The result explains what the link shows, for how
   long, and that body photos are never part of it, before it is made. The privacy policy names
   sharing; `IMAGES_VERSION` is bumped, so clients accept the new text at their next sign-in.

## Consequences

- The web's public surface grows by one page and one file route. Both depend on an unguessable
  token; they open nothing else of the account.
- The public web address of a link appears in the reverse proxy's access log, as any unlisted link
  does; the worker's log does not hold it.
- A tattooer cannot answer or comment through the link. A two-way exchange (comments, a studio
  plan) would be a further decision.
- The address of a link is shown once, when it is made: it cannot be shown again, only closed.
