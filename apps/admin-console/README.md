# Admin Console

This path is reserved for the Next.js admin and governance surface.

V1 responsibilities:

- office administration
- member lifecycle management
- guest governance and kill switch controls
- audit review
- recovery approval and support-elevation controls

This is not an end-user messaging surface in V1.

Current baseline artifacts:

- `src/audit-review.ts` defines the first audit list/detail screen models.
- `src/support-elevation.ts` maps support elevation status and lifecycle audit events to admin-facing controls.
- Audit review surfaces intentionally expose no export/download action in V1.
- Backend audit policy remains authoritative; this package only maps review DTOs to admin-facing view state.
