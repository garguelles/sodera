.PHONY: start issuer-start stop status logs

start:
	podman compose -f compose.dev.yaml up -d --build --wait

issuer-start:
	@test -f .env || (echo "Create api/.env with ENS_ISSUER_PRIVATE_KEY before starting the private worker" && exit 1)
	@node --env-file=.env scripts/check-local-issuer-key.mjs
	podman compose -f compose.dev.yaml --profile issuer up -d --build --wait issuer-worker

stop:
	podman compose -f compose.dev.yaml --profile issuer down --remove-orphans

status:
	podman compose -f compose.dev.yaml --profile issuer ps

logs:
	podman compose -f compose.dev.yaml --profile issuer logs -f
