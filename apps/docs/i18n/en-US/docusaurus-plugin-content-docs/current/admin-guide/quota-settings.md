---
title: Quota management
description: Configure personal credit quotas and their CNY conversion price.
---

# Quota management

Administrators open **Settings → Quota management** to configure the credit conversion price, initial organization member quotas, and self-registered user quotas.

## Credit conversion

Set the CNY amount represented by one credit. The default is CNY 0.01 per credit: a CNY 0.25 call consumes 25 credits. The price must be positive, with up to six decimal places.

Model prices remain in Model settings, in CNY per million tokens. Costs use the measured usage and the model price snapshot; credit consumption uses the conversion price when that usage is recorded. Later conversion changes do not reprice recorded credits. Consumption is rounded up to six decimal places. Remaining credits are displayed as integers by discarding the fraction; actual balances and quota checks retain decimal precision.

## Member populations

- **Initial organization member quotas** apply to each member subsequently created or imported. Changing defaults does not overwrite existing members.
- **Self-registered user quotas** apply to each user created through open registration. Changing these quotas also updates existing self-registered users, including individual overrides. Changing only the conversion price or organization defaults does not overwrite those quotas.

The registration switch remains under **System settings → Open registration**, independently of quotas. Adjust existing users individually or in bulk under **Users & groups → Users**.

## Immediate resets and bulk application

Quota management provides three bulk actions. Each button opens a confirmation dialog. Confirming takes effect immediately without choosing an execution time; canceling makes no changes.

- **Reset all organization member quotas** restores every organization member's remaining weekly, monthly, and total credits to 100% of their own current limits.
- **Reset all self-registered user quotas** restores every self-registered user's remaining weekly, monthly, and total credits to 100% of their own current limits.
- **Save and apply limits to all organization members** saves the organization's limits from the form as defaults and immediately overwrites all existing organization members' limits, including individual overrides. Blank values remove the corresponding restrictions. The confirmation dialog previews the new limits. This action does not reset consumed credits or save other edits to the conversion price or self-registration settings.

Bulk actions include active and disabled members of the selected population and do not change account status. Resets keep each user's limits, leave unlimited quotas unlimited, and ignore unsaved form edits. Historical consumption remains available, and subsequent consumption is deducted normally. Weekly and monthly quotas keep their calendar reset schedule.

To give every organization member new limits with 100% remaining, first save and apply the limits, then reset all organization member quotas.

## Weekly, monthly, and total limits

Both populations support all three limits in credits. Enter positive amounts with up to six decimal places. A blank field means unlimited for that period; all blank means unlimited usage. Clearing a self-registration limit also removes that restriction for existing self-registered users.

- Weekly quotas reset on Monday at midnight in the system time zone.
- Monthly quotas reset on the first day of each month in the system time zone.
- Total quotas are lifetime limits and do not reset automatically.

Each charge counts toward weekly, monthly, and lifetime usage without being charged three times. Reaching any configured limit prevents new tasks and follow-up requests. Running tasks finish and may bring final consumption above the limit. Adjusting limits does not reset credits already consumed.

Token and CNY cost statistics remain available. Quota management does not provide payments or top-ups.
