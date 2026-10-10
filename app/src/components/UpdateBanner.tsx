import { Linking, Pressable, Text, View } from 'react-native';
import { useUpdateCheck } from '../lib/updater';

/**
 * 顶部更新条。
 * 服务端登记了新版本才会出现；点一下去下载新的安装包。
 * 强制更新（低于服务端设定的最低版本）时不给关。
 */
export function UpdateBanner() {
  const { info, dismiss, force } = useUpdateCheck();

  if (!info) return null;

  const go = () => {
    if (info.apkUrl) Linking.openURL(info.apkUrl).catch(() => {});
  };

  return (
    <Pressable onPress={go} className="bg-card px-4 py-2.5 border-b border-line">
      <View className="flex-row items-center">
        <View className="flex-1">
          <Text className="text-body text-[13px] font-medium">
            有新版本 {info.versionName}
          </Text>
          <Text className="text-sub text-[11.5px] mt-0.5" numberOfLines={2}>
            {info.note || '修了些问题 建议更新'}
          </Text>
        </View>
        <View className="bg-accent rounded-full px-3 py-1.5">
          <Text className="text-onaccent text-[12px] font-semibold">
            {info.apkUrl ? '去更新' : '待发布'}
          </Text>
        </View>
        {!force ? (
          <Pressable onPress={dismiss} hitSlop={10} className="ml-3">
            <Text className="text-sub text-[16px]">×</Text>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}
