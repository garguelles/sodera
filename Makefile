.PHONY: start stop status logs

start:
	podman compose -f api/compose.dev.yaml up -d --build --wait --remove-orphans

stop:
	podman compose -f api/compose.dev.yaml down --remove-orphans

status:
	podman compose -f api/compose.dev.yaml ps

logs:
	podman compose -f api/compose.dev.yaml logs -f
