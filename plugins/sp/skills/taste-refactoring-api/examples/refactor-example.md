# Worked Example — Refactor a brittle HTTP API

## Before

```http
GET /api/getOrder?id=42
POST /api/updateOrder
POST /api/deleteOrder
```

```json
HTTP/1.1 200 OK
{
  "success": false,
  "errorCode": "NOT_FOUND",
  "message": "Order missing"
}
```

Problems:
- action verbs and generic endpoint family instead of a resource model;
- all outcomes tunneled through `200`;
- update semantics are unknown;
- deletion uses a non-idempotency-signaling shape;
- no concurrency protection;
- client must learn application-specific protocol conventions before HTTP semantics help.

## Target

```http
GET /orders/42
PATCH /orders/42
DELETE /orders/42
```

```http
HTTP/1.1 404 Not Found
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/order-not-found",
  "title": "Order not found",
  "status": 404,
  "detail": "No visible order exists with the supplied identifier."
}
```

For a race-sensitive update:

```http
PATCH /orders/42
If-Match: "rev-7"
Content-Type: application/merge-patch+json

{
  "shippingAddress": {
    "city": "San Jose"
  }
}
```

A stale revision can fail with a precondition response rather than silently overwriting another user’s change.

## Safe migration

1. Add `/orders/{id}` alongside legacy endpoints.
2. Make legacy handlers adapt into the new domain service so behavior stays aligned.
3. Emit telemetry when legacy endpoints are called.
4. Migrate first-party clients.
5. Mark legacy operations deprecated in docs/spec.
6. Set removal criteria based on client adoption and support policy.
7. Remove only after the agreed deprecation window.
