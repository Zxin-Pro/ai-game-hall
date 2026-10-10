import { View, Text, ScrollView, Pressable } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const SECTIONS: { h: string; p: string[] }[] = [
  {
    h: '1. 关于这个 App',
    p: [
      'AI 游戏厅是一个多人 AI 群聊式小游戏应用。你创建房间、选一个游戏、拉 3-9 个 AI 角色进群，AI 之间互相看得见消息，会争、会骗、会投票。',
      '本应用完全免费，不含广告、内购、付费墙，也不设每日游玩局数上限。',
    ],
  },
  {
    h: '2. AI 生成内容',
    p: [
      '所有 AI 角色的发言均由第三方大语言模型实时生成。我们会对输出做基础的内容安全过滤，但模型仍可能产出不准确、不恰当或与你预期不符的内容。',
      'AI 发言仅供娱乐，不构成任何专业意见，请勿作为现实决策依据。每条 AI 消息都带「AI」标识。',
    ],
  },
  {
    h: '3. 你的行为',
    p: [
      '请勿在插话中使用违法、色情、暴力、侮辱、歧视性内容，也请勿发布涉及他人隐私的信息。',
      '长按任意消息可以举报。我们会核查处理，情节严重的账号会被限制使用。',
    ],
  },
  {
    h: '4. 年龄分级',
    p: [
      '本应用内容分级为 12+。未满 12 周岁的用户请在监护人陪同下使用。',
      '我们提供防沉迷时长提醒，连续游玩 60 分钟会提示你休息。',
    ],
  },
  {
    h: '5. 账号',
    p: [
      '你需要注册一个账号才能创建房间。密码经过加密存储，我们不会以明文形式保存。',
      '你可以随时在「我的」里退出登录，或联系我们删除账号及关联数据。',
    ],
  },
];

export default function Terms() {
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-page" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center px-4 pt-2 pb-3">
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text className="text-sub text-[14px]">‹ 返回</Text>
        </Pressable>
        <Text className="text-body text-[16px] font-semibold flex-1 text-center">用户协议</Text>
        <View className="w-[40px]" />
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}>
        {SECTIONS.map((s) => (
          <View key={s.h} className="mb-6">
            <Text className="text-body text-[15px] font-semibold mb-2">{s.h}</Text>
            {s.p.map((t, i) => (
              <Text key={i} className="text-sub text-[13px] leading-5 mb-2">{t}</Text>
            ))}
          </View>
        ))}
        <Text className="text-faint text-[11px] mt-4">最后更新：2026-10</Text>
      </ScrollView>
    </View>
  );
}
