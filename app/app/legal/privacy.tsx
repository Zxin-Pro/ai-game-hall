import { View, Text, ScrollView, Pressable } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const SECTIONS: { h: string; p: string[] }[] = [
  {
    h: '我们收集什么',
    p: [
      '注册信息：昵称、密码（加密存储）。',
      '设备信息：设备型号与一个本地生成的设备指纹，仅用于防止批量注册。',
      '使用数据：对局局数、token 用量。这是我们做成本控制的唯一依据，不与第三方共享。',
    ],
  },
  {
    h: '我们不收集什么',
    p: [
      '不读取通讯录、短信、相册、位置。',
      '不接入任何广告 SDK，不做用户画像，不向广告商出售任何数据。',
      '不会把你和 AI 的对话内容用于训练模型。',
    ],
  },
  {
    h: '数据存在哪',
    p: [
      '所有数据存储在我们自建的服务器上（PostgreSQL），AI 调用由服务端发起，你的设备上不存在任何模型 API Key。',
      '对局消息会保留以便你回看回放。你可以随时申请删除。',
    ],
  },
  {
    h: '第三方',
    p: [
      'AI 发言由我们配置的大语言模型服务商生成，我们会把当轮所需的对话上下文发送给模型服务商。发送内容不包含你的昵称以外的账号信息。',
      '头像由 DiceBear 生成，不涉及你的真实照片。',
    ],
  },
  {
    h: '你的权利',
    p: [
      '你可以随时在「我的 → AI 记忆偏好」里查看和删除 AI 记住的关于你的信息。',
      '你可以申请导出或删除全部个人数据。',
    ],
  },
];

export default function Privacy() {
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-ink-950" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center px-4 pt-2 pb-3">
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text className="text-white/50 text-[14px]">‹ 返回</Text>
        </Pressable>
        <Text className="text-white text-[16px] font-semibold flex-1 text-center">隐私政策</Text>
        <View className="w-[40px]" />
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}>
        <Text className="text-white/40 text-[13px] leading-5 mb-6">
          一句话版本：我们只存必要的东西，不卖数据，不投广告，不做用户画像。
        </Text>
        {SECTIONS.map((s) => (
          <View key={s.h} className="mb-6">
            <Text className="text-white/85 text-[15px] font-semibold mb-2">{s.h}</Text>
            {s.p.map((t, i) => (
              <Text key={i} className="text-white/50 text-[13px] leading-5 mb-2">{t}</Text>
            ))}
          </View>
        ))}
        <Text className="text-white/20 text-[11px] mt-4">最后更新：2026-10</Text>
      </ScrollView>
    </View>
  );
}
