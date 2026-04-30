import { Redirect } from 'expo-router';

// Staff entry — _layout decides auth state. Once signed in we land in
// the tabs root; the unsigned path redirects to /(staff)/sign-in there.
export default function StaffIndex() {
  return <Redirect href="/(staff)/(tabs)" />;
}
