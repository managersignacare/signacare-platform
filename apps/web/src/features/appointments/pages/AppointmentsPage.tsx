import { SchedulingWorkspace } from '../../calendar/components/SchedulingWorkspace';

/**
 * Backwards-compatible alias route.
 *
 * `/calendar` is the canonical scheduling surface exposed in the
 * sidebar and operator-facing language, but we keep `/appointments`
 * wired to the same workspace so legacy deep links, bookmarks, and
 * dashboard shortcuts continue to function.
 */
export const AppointmentsPage = () => {
  return <SchedulingWorkspace routeLabel="My Calendar" />;
};

export default AppointmentsPage;
