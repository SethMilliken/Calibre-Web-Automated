# Calibre-Web Automated Bug Fixes

This branch contains a curated selection of enhancements and bug fixes that have
not yet been merged upstream.

## Fixes
- [Open PRs](https://github.com/crocodilestick/Calibre-Web-Automated/pulls/SethMilliken) I've submitted to the upstream CWA
- Suppress a handful of spammy and unhelpful debug log statements

## Setup
In order to use these changes you will need to use the [development
bindings](https://github.com/crocodilestick/Calibre-Web-Automated/blob/main/docker-compose.yml.dev#L36)
for Calibre Web Automated, that allow you to overlay local changes into your
Calibre Web Automated Docker container.

How to set up your local CWA repository (use `git@github.com:` instead of
`https://github.com/` for the repositories if you prefer ssh over HTTPS for cloning):
```
git clone https://github.com/crocodilestick/Calibre-Web-Automated.git
cd Calibre-Web-Automated
git remote add bugfix https://github.com/SethMilliken/Calibre-Web-Automated.git
git fetch --all
git checkout bugfix/bug-fixes
```

Add to your `docker-compose.yml`:
```
  volumes:
    /path/to/CWA-repo/cps:/app/calibre-web-automated/cps
```

This creates a new mount that overlays the runtime files in the CWA Docker
container so that it uses your local versions instead of the ones on the image.

Stop your CWA container and rebuild it (this may vary depending on how you run
CWA in Docker):
```
sudo docker compose down
sudo docker compose up
```

## Help

If you have any problems or questions, ping me (Araxia) on the [CWA Discord](https://discord.gg/EjgSeek94R).
