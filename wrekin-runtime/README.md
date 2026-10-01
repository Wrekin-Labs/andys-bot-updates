# Wrekin Runtime node

Bootstrap runtime node for Wrekin Cloud.

Current v0.1 scope is intentionally read-only:

- `/` runtime dashboard
- `/health` health endpoint
- `/api/info` node metadata
- `/api/capabilities` safe capability declaration
- `/ready` readiness / missing execution features

No command execution, secrets, shell, Docker socket, or unauthenticated write API is exposed in this bootstrap release.

Next phases:
1. signed node registration
2. scoped deployment jobs
3. container driver
4. health supervision and rollback
5. usage metrics and quotas
6. multi-node scheduling
