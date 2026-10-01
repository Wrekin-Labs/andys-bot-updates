# Wrekin Monitor

Bootstrap health monitoring for Wrekin Cloud.

It currently checks the public health endpoints for Wrekin Cloud and Wrekin Runtime with a five-second timeout and reports availability and latency.

No secrets are stored and no remote write or restart actions are performed.

Endpoints:
- `/` dashboard
- `/health` monitor health
- `/api/checks` aggregated target checks
