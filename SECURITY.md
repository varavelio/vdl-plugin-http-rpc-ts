# Security

This document describes how the generated code protects itself, and where
that protection ends.

The generated client and server are 100% dependency-free JavaScript. They
run on any runtime (browsers, Node.js, Deno, Bun, edge workers). Only the
thin adapters touch runtime APIs (`node:http` or Web Standards `Request`).

## What the generated code handles

**Request size.** The server reads at most 4 MiB per request. Anything
bigger is rejected with an `ok:false` envelope before middleware or handlers
run. You can change the limit with `SetMaxRequestBodyBytes`; passing zero or
a negative value restores the default.

Adapters enforce the cap while
buffering and the runtime re-checks buffered text, so even a faulty custom
adapter fails closed.

Bodies pre-parsed by web frameworks (Express and similar) bypass the byte cap by nature; those rely on the framework's own request size limit.

**Response size.** The client applies the same rule in the other direction:
at most 4 MiB per response, tunable with `WithMaxResponseBodyBytes`.
A compromised or misbehaving server cannot exhaust client memory.

**Malformed bodies.** A body must contain exactly one JSON value. Empty
bodies are valid empty input, as the protocol requires. Anything else,
including trailing garbage after a valid value, is answered with an
`ok:false` envelope and never reaches a handler.

**Input validation.** The generated types check the shape of every input
before the handler runs: required fields must be present and values must
match their declared types. Handler output is checked the same way before
it leaves the server. Invalid input stops there.

**Request isolation.** Procedure metadata is copied for each request, so an
interceptor or middleware that touches annotations cannot leak state into
other requests.

**Errors.** Internal failures (a body that cannot be read, a type that does
not match where it should) are returned as errors, never as silent values.
Responses that cannot be encoded fall back to a safe error envelope.

**Error privacy by default.** When a handler fails and you have not set a
custom error handler, the client receives a plain `Internal error`.
Framework prefixes, type names, and decoder details never leave the
server. Custom error handlers expose exactly what they return: if you
prefix or forward the raw error there, that is your choice, made on
purpose.

Even error encoding failures stay generic. If an error payload cannot be
encoded (for example, unencodable details from a custom handler), the
client receives the same plain `Internal error` envelope instead of
framework text.

Unknown routes and procedures answer a plain `Not found`. The wire never
carries path schemes, procedure names, or raw internal text: adapter
failures (bad path, context creation, catch-all) omit `originalError`
details, and only machine-readable `code` values (`NOT_FOUND`,
`INVALID_PROCEDURE`, `CONTEXT_ERROR`, `INTERNAL_ERROR`) distinguish the
cases. Malformed bodies keep their parse detail, which comes from the
standard JSON parser, not from framework internals.

## What it does not handle

TLS, rate limiting, and trusting the URLs you configure are your
responsibility, as usual. Client-side timeouts and retries are configurable
(`withTimeout`, `withRetries`) but default to a single 30s attempt. The same
goes for whatever your handlers and middleware do: the transport validates
and isolates, but it cannot fix insecure application logic.

## Reporting

If you find a way to break any of the guarantees above through the
generated code alone, please report it with a reproduction: schema,
request bytes, and observed behavior.
