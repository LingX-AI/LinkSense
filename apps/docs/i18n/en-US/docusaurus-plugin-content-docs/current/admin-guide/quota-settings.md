---
title: Quota management
description: Configure one member weekly quota and the CNY conversion price.
---

# Quota management

Administrators open **Settings → Quota management** to configure the credit conversion price and one weekly quota standard for all members.

## Credit conversion

Set the CNY amount represented by one credit. The default is CNY 0.01 per credit: a CNY 0.25 call consumes 25 credits. The price must be positive, with up to six decimal places.

Model prices remain in Model settings, in CNY per million tokens. Costs use measured usage and the model price snapshot; credit consumption uses the conversion price when that usage is recorded. Later conversion changes do not reprice recorded credits. Consumption is rounded up to six decimal places. Remaining credits are displayed as integers by discarding the fraction; actual balances and quota checks retain decimal precision.

## Member weekly quota

The member weekly quota is the shared default for members subsequently created by an administrator, imported from Excel, or created through open registration. Enter a positive amount with up to six decimal places. Blank means unlimited. The quota resets every Monday at midnight in the system time zone.

Saving the setting updates only the default and does not overwrite existing members' individual weekly quotas. Existing members can still be adjusted individually or in bulk under **Users & groups → Users**. The open-registration switch remains under **System settings → Open registration**, but self-registered users no longer have a separate quota standard.

## Reset and apply to all

Quota management provides two immediate bulk actions. Each action opens a confirmation dialog; canceling makes no changes.

- **Reset quotas for all** restores every existing member's weekly quota to 100% of their own current limit. It does not change limits, and unlimited members remain unlimited.
- **Apply limit to all** saves the weekly quota from the form and immediately overwrites every existing member's individual weekly quota, including previous individual adjustments. Blank makes every member unlimited. This action does not reset used credits or save other unsaved edits to the conversion-price form.

Both actions include active and disabled members and do not change account status. Historical usage remains available. Consumption after a manual reset is deducted normally, and the calendar-week reset schedule remains unchanged.

To give all members a new limit with 100% remaining, first apply the limit to all, then reset quotas for all.

Reaching the weekly quota prevents new tasks and follow-up requests. Running tasks finish and may bring final consumption above the limit. Adjusting the quota does not delete or reprice recorded credits.

Token and CNY cost statistics remain available. Quota management does not provide payments or top-ups.
