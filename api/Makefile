.PHONY: start stop status logs

start:
	podman compose -f compose.dev.yaml up -d --build --wait --remove-orphans

stop:
	podman compose -f compose.dev.yaml down --remove-orphans

status:
	podman compose -f compose.dev.yaml ps

logs:
	podman compose -f compose.dev.yaml logs -f
