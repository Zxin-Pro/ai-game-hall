import type { DemoGame } from '../data/demo';

/* ------------------------------------------------------------------ */
/* 离线演示对局：没有后端时，房间里放一段脚本化的 AI 群聊                */
/* 目的是让 APK 装上去就能看到「一群 AI 在吵」长什么样                    */
/* ------------------------------------------------------------------ */

export interface DemoEvent {
  /** 距离上一条的毫秒数 */
  after: number;
  type: 'system' | 'ai' | 'user';
  name: string;
  content: string;
  round: number;
  phase: string;
  /** 逐字打出来的速度（ms/字），0 = 一次性出现 */
  charDelay?: number;
}

/** 每种引擎的台词池，用角色名替换 {n} */
const LINES: Record<string, string[]> = {
  hidden_role: [
    '{n}：我先说，昨晚的事情有点奇怪，你们不觉得吗',
    '{n}：我这边有个信息，但现在说出来对我不利',
    '{n}：别急着站边，先看谁在保谁',
    '{n}：我怀疑 {t}，他刚才那句话前后矛盾',
    '{n}：我票 {t}，没有别的理由，就是直觉',
    '{n}：我是好人，但我拿不出证据，你们信不信随你',
    '{n}：如果 {t} 是狼，那我今晚必死',
    '{n}：我这个人不太会演，说多了反而像',
  ],
  group_chat: [
    '{n}：你说这话的时候，我其实愣了一下',
    '{n}：我不是想多问，就是有点在意',
    '{n}：行，那就当我没说',
    '{n}：我这个人不太会表达，你别误会',
    '{n}：其实我早就想跟你聊这个了',
    '{n}：你们先聊，我去倒杯水',
    '{n}：我觉得这件事没那么简单',
    '{n}：那你怎么看',
  ],
  debate: [
    '{n}：审判长，我方有证据证明对方陈述与事实不符',
    '{n}：对方忽略了一个关键点——时间线根本对不上',
    '{n}：我反对，这个问题与本案无关',
    '{n}：证人，你确定你当时看到的是这个时间吗',
    '{n}：请法庭记录在案，我方坚持原主张',
    '{n}：如果按对方逻辑，那任何人都可以被这样指控',
    '{n}：我方提交第二份证据，请书记员登记',
    '{n}：本庭认为，反对成立',
  ],
  negotiation: [
    '{n}：这个价格我没法回去交代',
    '{n}：我理解你的顾虑，不过市场行情就是这样',
    '{n}：我可以再加一点，但这是最后一次',
    '{n}：如果今天定不下来，我们就先放一放',
    '{n}：你说的这个数，比我们预算高了整整两成',
    '{n}：给我一个让我能说服董事会的理由',
    '{n}：别急，坐下来慢慢谈',
    '{n}：我不喜欢威胁，但时间确实不多了',
  ],
  simulation: [
    '{n}：我的判断是，先砸市场，产品可以晚一个月',
    '{n}：按现在的烧钱速度，我们撑不过两个季度',
    '{n}：这个投入能换来三倍的市场热度，值',
    '{n}：我反对砍技术预算，产品塌了什么都没了',
    '{n}：你们的护城河到底是什么',
    '{n}：现在是最好的融资窗口，别等指标完美',
    '{n}：我提议先把增长停一停，保住现金流',
    '{n}：那就投票吧，别耗着了',
  ],
};

/** 每种引擎的系统旁白 */
const NARRATION: Record<string, string[]> = {
  hidden_role: ['天黑请闭眼', '昨晚是平安夜，没有人出局', '请从 1 号开始发言', '投票开始，请所有人投出你怀疑的人'],
  group_chat: ['汤面已经放在桌上', '轮到你了，说点什么吧', '气氛有点变了'],
  debate: ['现在开庭', '原告方开始陈述', '被告方答辩', '双方举证', '证人上场', '陪审团开始评议'],
  negotiation: ['双方坐定', '开始报价', '进入拉锯', '最后通牒'],
  simulation: ['第一次全体会议', '产品周期开始', '增长压力上来了', '融资窗口打开', '本轮复盘'],
};

export function buildDemoScript(game: DemoGame): DemoEvent[] {
  const out: DemoEvent[] = [];
  const ni = NARRATION[game.engineType] ?? NARRATION.group_chat!;
  const pool = LINES[game.engineType] ?? LINES.group_chat!;
  const roles = game.roles.length ? game.roles : [game.roles[0]!];
  const rounds = Math.max(2, Math.min(game.maxRounds, 3));

  out.push({
    after: 400, type: 'system', name: '系统',
    content: `《${game.name}》开局，参与者：${roles.map((r, i) => `${i + 1}号${r.name}`).join('、')}`,
    round: 1, phase: 'init',
  });

  let li = Math.floor(Math.random() * pool.length);
  let ri = 0;
  for (let round = 1; round <= rounds; round++) {
    for (let p = 0; p < Math.min(game.phases.length, 4); p++) {
      const phase = game.phases[p]!;
      if (phase.narration || phase.mode === 'narration') {
        out.push({
          after: 700, type: 'system', name: '系统',
          content: phase.narration ?? ni[p % ni.length]!,
          round, phase: phase.key,
        });
      }
      // 每个阶段挑 2 个角色说话
      for (let k = 0; k < 2; k++) {
        const speaker = roles[ri % roles.length]!;
        ri++;
        const other = roles[(ri + 1) % roles.length]!;
        const line = pool[li % pool.length]!.replace('{n}', speaker.name).replace('{t}', other.name);
        li++;
        out.push({
          after: 900 + Math.floor(Math.random() * 700),
          type: 'ai', name: speaker.name, content: line,
          round, phase: phase.key, charDelay: 28,
        });
      }
    }
  }

  out.push({
    after: 900, type: 'system', name: '系统',
    content: '（演示结束。接上后端之后，这些发言会由真实模型现场生成。）',
    round: rounds, phase: 'ending',
  });

  return out;
}
