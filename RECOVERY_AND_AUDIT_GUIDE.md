# Recovery & Audit Mechanism - Implementation Guide

## Overview

This document outlines the recovery and audit mechanism implemented for the MedFlow application, designed to allow administrators to recover from accidental AI edits or user mistakes.

## Features Implemented

### 1. Change History / Audit Trail

**What's Tracked:**
- Medicines: created, edited, deleted
- Categories: created, edited, deleted

**Captured Data:**
- Record type (Medicine/Category)
- Record name
- Action (CREATE, UPDATE, SOFT_DELETE, RESTORE)
- User who made the change (ID, name, email)
- Timestamp
- Previous values (before/after comparison)
- Facility information

**Database Model:**
- Uses existing `AuditLog` model in Prisma schema
- Stores detailed JSON in `details` field with:
  - `name`: Record name
  - `previousValues`: State before change
  - `currentValues`: State after change
  - `changeDetails`: Human-readable description

### 2. Recent Changes Page

**URL:** `/admin/recovery`

**Access:** Admin-only (NURSE_ADMIN, PROVINCIAL_MANAGER, SUPER_ADMIN)

**Features:**
- Tabbed interface for different recovery views
- View all changes with timestamp, user, action, and details
- Filter by entity type (Medicine/Category)
- Display changed values with before/after comparison
- Search and navigate through change history

**Tabs:**
1. **Recent Changes** - Complete audit trail of all create/update/delete actions
2. **Deleted Medicines** - List of soft-deleted medicines with restore option
3. **Deleted Categories** - List of soft-deleted categories with restore option

### 3. Restore Support

**For Medicines:**
- Endpoint: `POST /api/medicines/:id/restore`
- Checks if medicine name already exists in active records
- Restores `isActive=true`, clears `deletedAt`, `deletedById`
- Logs RESTORE action to audit trail

**For Categories:**
- Endpoint: `POST /api/categories/:id/restore`
- Checks if category name already exists in active records
- Restores `isActive=true`, clears `deletedAt`, `deletedById`
- Logs RESTORE action to audit trail

**Admin Restore Endpoints:**
- `POST /admin/restore-medicine/:id`
- `POST /admin/restore-category/:id`

### 4. Safe Rollback Support

**View Previous Version:**
- Endpoint: `GET /medicines/:id/change-history`
- Endpoint: `GET /categories/:id/change-history`
- Returns complete history of all changes to a record
- Shows all previous values and current values

**Previous Version Details:**
- Endpoint: `GET /medicines/:id/previous-version/:changeId`
- Endpoint: `GET /categories/:id/previous-version/:changeId`
- Returns specific change with before/after comparison

### 5. Admin-Only Access

**Protected Endpoints:**
- All recovery and audit endpoints require authentication
- `requireAdmin` middleware checks user role
- Allowed roles: NURSE_ADMIN, PROVINCIAL_MANAGER, SUPER_ADMIN
- Returns 403 error if user lacks admin privileges

### 6. New Service: Change History Service

**File:** `src/services/changeHistory.ts`

**Key Functions:**
- `logChangeHistory()` - Log change with before/after values
- `getEntityChangeHistory()` - Get all changes for an entity
- `getRecentChanges()` - Get recent changes across entities
- `getPreviousVersion()` - Get specific version before a timestamp
- `formatChangeForDisplay()` - Format change for UI display
- `getChangeDiffSummary()` - Get summary of what changed

## Implementation Details

### Backend Changes

#### 1. Medicines Route (`src/routes/medicines.ts`)
- Updated all CRUD operations to use `logChangeHistory()`
- CREATE: Logs new values
- UPDATE: Captures previous and current values, calculates changed fields
- SOFT_DELETE: Logs deletion with status change
- RESTORE: Logs restoration
- **New Endpoints:**
  - `GET /medicines/:id/change-history` - View full history
  - `GET /medicines/:id/previous-version/:changeId` - View specific version

#### 2. Categories Route (`src/routes/categories.ts`)
- Updated all CRUD operations to use `logChangeHistory()`
- Same pattern as medicines
- **New Endpoints:**
  - `GET /categories/:id/change-history` - View full history
  - `GET /categories/:id/previous-version/:changeId` - View specific version

#### 3. Admin Route (`src/routes/admin.ts`)
- **New Endpoints:**
  - `GET /admin/recent-changes` - All recent changes (paginated)
  - `GET /admin/deleted-medicines` - Soft-deleted medicines
  - `GET /admin/deleted-categories` - Soft-deleted categories
  - `POST /admin/restore-medicine/:id` - Restore deleted medicine
  - `POST /admin/restore-category/:id` - Restore deleted category

#### 4. Change History Service (`src/services/changeHistory.ts`)
- New service for centralized change tracking
- Exports types and utility functions
- Replaces basic `logAudit()` calls with rich change tracking

### Frontend Changes

#### Recovery Page (`frontend/src/app/(app)/admin/recovery/page.tsx`)
- Admin-only recovery dashboard
- Three-tab interface:
  1. **Recent Changes** - Audit trail with change details
  2. **Deleted Medicines** - Restore deleted medicines
  3. **Deleted Categories** - Restore deleted categories
- Change detail modal showing before/after values
- Restore confirmation dialog
- Displays user who made changes and timestamps
- Color-coded action badges (Create: green, Update: blue, Delete: red, Restore: purple)

## Workflow: Recovery from Accidental Edit

### Scenario 1: Accidental Medicine Edit
1. User navigates to `/admin/recovery`
2. Clicks "Recent Changes" tab
3. Finds the unwanted edit in the audit trail
4. Clicks "View" to see before/after values
5. **Option A:** Manually re-edits to correct values
6. **Option B:** If significant damage, soft-delete and restore if needed

### Scenario 2: Accidental Medicine Deletion
1. Administrator notices medicine is missing
2. Navigates to `/admin/recovery`
3. Clicks "Deleted Medicines" tab
4. Finds the deleted medicine
5. Clicks "Restore"
6. Confirms restoration
7. Medicine becomes active again with all data intact

### Scenario 3: Auditing Changes
1. Facility manager notices suspicious activity
2. Navigates to `/admin/recovery`
3. Reviews "Recent Changes" tab
4. Can see who made what changes and when
5. View detailed before/after values by clicking "View"
6. Take appropriate action based on findings

## Data Structure: Audit Trail Example

```json
{
  "id": "cuid123",
  "action": "UPDATE",
  "entityType": "Medicine",
  "entityId": "med456",
  "details": {
    "name": "Paracetamol 500mg",
    "previousValues": {
      "medicineName": "Paracetamol 500mg",
      "reorderThreshold": 50,
      "leadTimeDays": 10
    },
    "currentValues": {
      "medicineName": "Paracetamol 500mg",
      "reorderThreshold": 100,
      "leadTimeDays": 14
    },
    "changeDetails": "Modified: reorderThreshold, leadTimeDays"
  },
  "userId": "user789",
  "user": {
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com"
  },
  "createdAt": "2024-01-15T10:30:00Z"
}
```

## API Endpoints Summary

### Medicine Recovery
- `GET /medicines/:id/change-history` - View all changes to a medicine
- `GET /medicines/:id/previous-version/:changeId` - View specific previous version
- `POST /medicines/:id/restore` - Restore soft-deleted medicine

### Category Recovery
- `GET /categories/:id/change-history` - View all changes to a category
- `GET /categories/:id/previous-version/:changeId` - View specific previous version
- `POST /categories/:id/restore` - Restore soft-deleted category

### Admin Recovery
- `GET /admin/recent-changes` - Get recent changes (optional limit & entityTypes filter)
- `GET /admin/deleted-medicines` - Get all soft-deleted medicines
- `GET /admin/deleted-categories` - Get all soft-deleted categories
- `POST /admin/restore-medicine/:id` - Admin restore medicine
- `POST /admin/restore-category/:id` - Admin restore category

## Security Considerations

### Admin-Only Protection
- All recovery endpoints require admin middleware
- User role validation on every request
- Returns 403 Forbidden if not authorized

### Non-Destructive Operations
- Soft-delete maintains data integrity
- No permanent deletion implemented
- All changes are reversible

### Audit Trail
- Complete history of all changes
- User attribution on every action
- Timestamps on all operations

## Files Modified/Created

### Backend
1. **Modified:** `src/routes/medicines.ts`
   - Added change history tracking
   - Added new recovery endpoints
   - Imports `logChangeHistory` service

2. **Modified:** `src/routes/categories.ts`
   - Added change history tracking
   - Added new recovery endpoints
   - Imports `logChangeHistory` service

3. **Modified:** `src/routes/admin.ts`
   - Added recovery page endpoints
   - Added restore endpoints
   - Added deleted medicines/categories listings

4. **Created:** `src/services/changeHistory.ts`
   - Change history service
   - Utility functions for tracking
   - Formatting functions for display

### Frontend
5. **Created:** `frontend/src/app/(app)/admin/recovery/page.tsx`
   - Recovery dashboard page
   - Change history viewer
   - Restore UI with confirmations
   - Deleted records browser

## Testing Checklist

### Audit Trail
- [ ] Create a medicine - verify audit entry with currentValues
- [ ] Edit a medicine - verify previousValues and currentValues captured
- [ ] Edit multiple fields - verify all changed fields tracked
- [ ] Delete a medicine - verify SOFT_DELETE action logged
- [ ] Restore a medicine - verify RESTORE action logged
- [ ] Same tests for categories

### Admin Recovery Page
- [ ] Navigate to `/admin/recovery` as admin
- [ ] View recent changes tab - all actions visible
- [ ] Click "View" on a change - shows before/after values
- [ ] View deleted medicines tab - deleted medicines listed
- [ ] Click restore - confirmation dialog appears
- [ ] Complete restore - medicine becomes active
- [ ] Same for categories

### Access Control
- [ ] Try to access recovery page as non-admin - should be blocked
- [ ] Verify 403 error on recovery endpoints for non-admin users
- [ ] Test with different admin roles (all should have access)

### Data Integrity
- [ ] Verify restored records have correct values
- [ ] Verify audit trail shows restore action
- [ ] Verify no data loss on soft-delete/restore cycle
- [ ] Verify duplicate name check on restore

## Future Enhancements

1. **Bulk Operations**
   - Restore multiple records at once
   - Bulk soft-delete with audit trail

2. **Advanced Filtering**
   - Filter by date range
   - Filter by user
   - Filter by action type
   - Filter by facility

3. **Export & Reporting**
   - Export audit trail to CSV
   - Generate compliance reports
   - Activity timeline visualization

4. **Rollback Operations**
   - Rollback to specific timestamp
   - Batch restore operations
   - Undo last N changes

5. **Notifications**
   - Alert admins on deletions
   - Activity digest emails
   - Real-time change notifications

## Compliance & Standards

### HIPAA Considerations
- All changes are tracked with user attribution
- Audit trail maintains data integrity
- Deletion is soft (preserves history)
- No permanent data loss

### ISO 27001
- Audit trail provides accountability
- Change tracking for compliance
- User authentication on all operations
- Access control implemented

## Support & Troubleshooting

### Common Issues

**Q: Can't find deleted record?**
- Verify record was actually soft-deleted (check audit trail)
- Check if similar name exists that prevented restore
- Check user permissions

**Q: Change history empty?**
- Verify audit logs exist in database
- Check user has admin permissions
- Verify correct entityId is being queried

**Q: Restore failed with "name already exists"?**
- Another record with same name was created
- Need to rename new record or delete it first
- Or manually edit the soft-deleted record before restore

## Conclusion

The recovery and audit mechanism provides comprehensive change tracking and recovery capabilities without modifying core business logic, inventory calculations, or authentication systems. Administrators can now confidently recover from accidental changes and maintain compliance with audit trail requirements.
