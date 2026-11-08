# Infrastructure

Reserved for Dockerfiles, Docker Compose, and environment configuration.
No deployment or privileged packet capture configuration is implemented in this
foundation. Docker is not required to install, typecheck, or build the applications.

When capture is implemented, assess host network visibility, tcpdump availability,
least-privilege Linux capabilities, log access, and supported host operating systems.
Never make the API container privileged to accommodate the agent.
