---
title: Publish and manage sites
description: Publish an HTML deliverable as a public website, then update, unpublish, download, or delete it.
---

# Publish and manage sites

LinkSense can publish a registered HTML deliverable from a task as a public site. Visitors do not need to sign in, so anyone with the link can open it. Review the page for sensitive information before publishing.

## Publish a new site

1. Open the preview for an HTML deliverable in a task.
2. Choose **Publish as site** from the preview toolbar.
3. Select **New site**, then enter a site name and optional description.
4. Optionally enter a link name, or leave it blank to generate one.
5. Choose **Publish site** and wait for the site link.
6. Copy the link and test the content and interactions in a signed-out window.

A custom link name must contain 3–80 letters, numbers, or hyphens without a leading or trailing hyphen. Choose another name if it is already in use.

A site may include CSS, JavaScript, images, fonts, and other static resources saved when the deliverable was registered. Publishing fails if a standalone HTML file refers to local files that were not saved. Ask LinkSense to regenerate and register the complete web deliverable in that case.

## Update an existing site

When publishing from a newer HTML deliverable, choose **Update existing site**, search for a site you own, and select it. After a successful update:

- the site keeps its link, name, and description;
- the public content switches to the new web deliverable;
- the source task becomes the task that supplied the new page;
- an unpublished site remains unpublished until you republish it from **My sites**.

You can also open **Resource library → My sites**, choose **Publish update** from a site's menu, and select an HTML deliverable from its current source task. If that task was deleted, start from a deliverable in another task and choose **Update existing site**.

## Manage My sites

Open **Resource library → My sites** to search by site name or link and filter by **Published** or **Unpublished**.

Each site provides these actions:

- **Visit or copy link:** open the current public version or share its link.
- **Edit:** change its name, description, or link name. Changing the link name immediately invalidates the old link.
- **Publish update:** select a newer HTML deliverable from the source task.
- **Unpublish or republish:** control visitor access. Unpublishing keeps the site, reserved link, and saved version.
- **Download website:** download the complete current version as a ZIP archive.
- **Delete site:** permanently delete the site, every published version, and its link reservation. The original task and deliverable remain, and the deleted link name can be used again.

Permanently deleting the source task automatically unpublishes its sites, but their saved versions remain downloadable from **My sites**. You can later generate a page in another task, choose **Update existing site**, reconnect it, and republish.

## Public access and security boundaries

Public sites run in an isolated surface. They cannot read LinkSense sign-in cookies, local storage, or the parent page, and cannot register a service worker. This feature hosts static websites and browser-side interactions; it does not run server programs or inherit your LinkSense permissions.

Visitors' browsers load external HTTPS resources directly, subject to availability and cross-origin rules. A site cannot rely on LinkSense authentication, server-side route fallback, or persistent same-origin browser storage. Before publishing, confirm that:

- the page and its static resources load completely;
- it contains no passwords, tokens, personal data, internal addresses, or task content that should remain private;
- forms and external requests do not send data to an untrusted service;
- old links behave as expected after you unpublish, rename, or delete the site.

See [Files, previews, and deliverables](./files-and-results.md) for previewing, downloading, and browsing task artifacts.
