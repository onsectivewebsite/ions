import { Redirect } from 'expo-router';

// TV root — _layout decides where to send us based on auth + pairing.
export default function TvIndex() {
  return <Redirect href="/(tv)/display" />;
}
