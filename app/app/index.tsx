import { Redirect } from 'expo-router';
import { useAuth } from '../src/store/auth';

/** 有登录态进游戏厅，没有就去登录 */
export default function Index() {
  const user = useAuth((s) => s.user);
  return <Redirect href={user ? '/(tabs)' : '/(auth)/login'} />;
}
