---
title: Manage user feedback
description: Review feedback text and images submitted by users and safely delete records that are no longer needed.
---

# Manage user feedback

:::info Administrator action
Go to **Settings → User feedback**. Regular users can view their own submissions and replies under **My feedback**, but cannot read submissions from other users.
:::

## Review feedback

The paginated list shows the submitter, a text excerpt, image count, reply status, and submission time. Select **View** to read the complete text and open image previews. If an image fails to load, refresh before asking the user to resend sensitive material through an uncontrolled channel.

Feedback may contain business information that the user chose to submit. Use it only for issue diagnosis and avoid copying it into logs, public tasks, or unrelated external services. Feedback is not an audit log and is not automatically joined to a particular task execution.

## Reply to a user

Open the feedback details, write a reply or add images, and select **Send reply**. Text-only, image-only, and combined replies are supported. Each reply allows up to 2,000 characters and nine images, with a maximum of 5 MB per image. PNG, JPEG, WebP, and GIF are supported, including pasted images.

You can reply more than once; replies appear chronologically. Failed submissions preserve the draft and selected images. After a successful reply, the user can read it under **My feedback**, and the list shows **Replied**. This status does not mean the issue is resolved.

## Delete feedback

Deletion permanently removes the feedback, every reply, and all their images and cannot be undone. Confirm that necessary handling is complete and organizational retention rules allow deletion. It does not delete the submitter, tasks, audit records, or usage facts.

## Handling guidance

- Start with the reported time, page, and stable error code.
- Ask for additional information only through an approved organizational channel.
- Never request passwords, tokens, API keys, QR codes, or one-time links.
- For system incidents, correlate the report with [System health](./health.md) and [Audit logs](./audit.md).

