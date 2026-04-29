import { Redirect } from 'expo-router';

// Staff entry — _layout decides auth state and redirects appropriately.
// This index is the in-bounds destination after sign-in completes.
export default function StaffIndex() {
  return <Redirect href="/(staff)/dashboard" />;
}
