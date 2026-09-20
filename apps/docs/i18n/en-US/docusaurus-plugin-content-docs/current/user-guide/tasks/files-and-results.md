---
title: Files, previews, and deliverables
description: Upload task attachments, preview content, and download generated files.
---

# Files, previews, and deliverables

## Add attachments

Choose files in the composer, wait for upload to finish, and then send the request. Common office, PDF, text, image, spreadsheet, presentation, and archive files are accepted subject to the limits shown by the deployment.

Name the files in your prompt when several are attached.

When you paste a large amount of text, LinkSense may convert it to a text attachment. Review its name and content before sending. It remains subject to the same size, permission, and security limits as a manually uploaded file.

## Preview files

Supported attachments and deliverables open inside the task. Images, PDFs, Word files, spreadsheets, presentations, HTML, archives, text, and supported audio or video use appropriate page, zoom, worksheet, slide, file-list, or playback controls. A file that cannot be safely previewed may still be downloaded when you have access.

Previews are read-only. HTML deliverables run in an isolated surface and cannot inherit the LinkSense page's privileges.

Presentation, Word, spreadsheet, and HTML previews can attach a request to selected content. You can collect several requests before sending them; see [Annotate a file preview](./file-annotations.md).

## View diagrams in responses

After a Mermaid block is complete, LinkSense renders it as a diagram preview adapted to the current light or dark theme. Open the diagram actions to copy the Mermaid source, export a PNG, or expand the preview and zoom or pan through details. While a response is still streaming, a loading state prevents incomplete source from being treated as the final diagram.

If rendering fails, you can still copy the source and send it with the observed error back to the task for correction. An exported PNG reflects the current rendering and is not registered as a new task artifact.

## Download deliverables

Generated documents and media appear as deliverable cards. A download action creates a short-lived authorized URL. If it expires, download again from the task; do not treat the temporary URL as a permanent share.

An HTML deliverable can also be published as a public site that does not require sign-in. See [Publish and manage sites](./publish-websites.md) for publishing, updates, unpublishing, and security boundaries.

## Browse task artifacts in one place

Open **Resource library** from the sidebar and choose **Task artifacts** to browse registered deliverables from your tasks by task name and creation time. Supported files use the same preview experience as the task page, and every listed file can be downloaded directly. Artifacts from archived tasks remain listed with an archived label.

Search matches both task names and filenames. Use the file type filter beside it to show images, Word, Excel, PPT, HTML, PDF, archives, text, audio, video, or other files. Combine the filter with a search term to narrow the results further, or select **All types** to remove the type restriction.

Select a task name to return to the original task for context. Artifacts from a permanently deleted task are no longer available through this list.

## Better file results

- Specify the required format and filename.
- Describe the directory or archive structure for multiple files.
- Review the preview before requesting revisions.
- Move important downloads to an organization-approved storage location.

:::warning Sensitive data
Upload only information needed for the work. A selected plugin or external tool may process inputs according to its declared capabilities, so review its risk summary first.
:::
