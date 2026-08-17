import {
  storyboardSchema,
  type SoundEffectTag,
  type Storyboard,
  type StoryboardScene,
} from "@stickmotion/shared";

const recommendedGainDb: Record<SoundEffectTag, number> = {
  pop: -8,
  click: -10,
  whoosh: -10,
  success: -8,
  error: -8,
  typing: -12,
  clock: -12,
  impact: -8,
  laughter: -14,
  applause: -12,
  cheer: -12,
  surprise: -12,
  question: -13,
  notification: -14,
  camera: -12,
  phone: -14,
  footsteps: -15,
  door: -13,
  money: -12,
  food: -16,
  cooking: -16,
  water: -17,
  nature: -18,
  traffic: -17,
  crowd: -18,
  animal: -16,
  magic: -12,
  tension: -17,
  sad: -16,
  game: -13,
  mechanical: -15,
  sci_fi: -13,
};

const expandedSemanticRules: ReadonlyArray<{
  tag: SoundEffectTag;
  pattern: RegExp;
}> = [
  {
    tag: "applause",
    pattern: /掌声|鼓掌|拍手|全场响起|applause/iu,
  },
  {
    tag: "cheer",
    pattern: /欢呼|喝彩|振奋|夺冠|赢了|cheer/iu,
  },
  {
    tag: "laughter",
    pattern: /笑了|大笑|哈哈|笑声|忍不住笑|搞笑|幽默|laugh/iu,
  },
  {
    tag: "surprise",
    pattern: /惊讶|震惊|没想到|意外|居然|竟然|surprise|shock/iu,
  },
  {
    tag: "question",
    pattern: /为什么|怎么会|究竟|疑问|困惑|想不明白|question|why|how/iu,
  },
  {
    tag: "notification",
    pattern: /收到消息|通知|提醒|提示|新消息|到账通知|notification/iu,
  },
  {
    tag: "camera",
    pattern: /拍照|照片|相机|镜头记录|截图|摄影|camera|photo/iu,
  },
  {
    tag: "phone",
    pattern: /电话|手机|来电|接听|挂断|拨号|通话|phone|call/iu,
  },
  {
    tag: "footsteps",
    pattern: /走来|走过去|脚步|跑过去|冲过去|离开现场|footstep|walk|run/iu,
  },
  {
    tag: "door",
    pattern: /开门|关门|推门|敲门|门铃|走进房间|door|knock/iu,
  },
  {
    tag: "money",
    pattern: /收入|赚钱|付款|收款|到账|现金|金币|预算|成本|money|cash|coin/iu,
  },
  {
    tag: "cooking",
    pattern: /切菜|下锅|翻炒|油炸|煎|煮|炖|厨房|烹饪|做饭|cook|kitchen/iu,
  },
  {
    tag: "food",
    pattern: /吃饭|吃东西|咀嚼|喝水|美食|味道|好吃|饥饿|food|eat|drink/iu,
  },
  {
    tag: "water",
    pattern: /水流|倒水|雨水|海浪|河流|滴水|下雨|water|rain|wave/iu,
  },
  {
    tag: "nature",
    pattern: /森林|树林|鸟叫|虫鸣|大自然|山谷|草原|风吹|nature|forest|bird/iu,
  },
  {
    tag: "traffic",
    pattern: /开车|汽车|公交|地铁|火车|交通|路上|堵车|traffic|car|train/iu,
  },
  {
    tag: "crowd",
    pattern: /人群|街上|商场|市场|会议现场|办公室里|热闹|crowd/iu,
  },
  {
    tag: "animal",
    pattern: /小猫|小狗|动物|宠物|鸟儿|马匹|狮子|animal|cat|dog/iu,
  },
  {
    tag: "magic",
    pattern: /魔法|奇迹|变身|梦幻|闪闪发光|能量|magic|spell/iu,
  },
  {
    tag: "tension",
    pattern: /紧张|悬疑|恐怖|害怕|心跳|危机|压迫感|tension|horror/iu,
  },
  {
    tag: "sad",
    pattern: /难过|悲伤|失落|哭了|眼泪|叹气|遗憾|sad|cry/iu,
  },
  {
    tag: "game",
    pattern: /游戏|通关|得分|升级|解锁|奖励|玩家|game|level|score/iu,
  },
  {
    tag: "mechanical",
    pattern: /机械|齿轮|设备启动|马达|引擎|金属|machine|gear/iu,
  },
  {
    tag: "sci_fi",
    pattern: /科幻|未来世界|机器人|飞船|激光|赛博|高科技|sci.?fi|cyber/iu,
  },
  {
    tag: "typing",
    pattern: /输入|打字|键盘|写文案|写代码|编辑文字|回复消息|搜索/iu,
  },
  {
    tag: "clock",
    pattern: /时间|等待|倒计时|截止|分钟|小时|秒钟|拖延|迟到|闹钟/iu,
  },
  {
    tag: "click",
    pattern: /点击|按钮|选择|勾选|打开设置|确认|保存|提交|下载|上传/iu,
  },
  {
    tag: "success",
    pattern: /成功|完成|做到|达成|解决|通过|获胜|升级|突破|交付/iu,
  },
  {
    tag: "error",
    pattern: /失败|错误|报错|故障|中断|危险|风险|警告|异常|超时/iu,
  },
  {
    tag: "impact",
    pattern: /重点|关键|突然|必须|真相|注意|核心|千万|震撼|结论|记住/iu,
  },
  {
    tag: "pop",
    pattern: /出现|弹出|发现|想法|灵感|问题|答案|提醒|明白了|懂了/iu,
  },
  {
    tag: "whoosh",
    pattern: /开始|接下来|然后|转向|进入|离开|切换|下一步|最后|转场/iu,
  },
];

const semanticRules: ReadonlyArray<{
  tag: SoundEffectTag;
  pattern: RegExp;
}> = [
  {
    tag: "error",
    pattern:
      /失败|失误|错误|报错|故障|中断|断开|卡住|危险|风险|警告|崩溃|异常|糟糕|拒绝|无效|冲突|超时|无法|不行|没成功|出错|红灯|警报|\bfail(?:ed|ure)?\b|\berror\b|\bwarning\b|\bdanger\b|\bcrash(?:ed)?\b|\btimeout\b/iu,
  },
  {
    tag: "success",
    pattern:
      /成功|完成|搞定|做到|达成|解决|通过|获胜|胜利|升级|增长|突破|成交|到账|毕业|上线|发布|交付|好消息|值得庆祝|终于可以|\bsuccess(?:ful)?\b|\bcomplete(?:d)?\b|\bdone\b|\bwin\b|\bpassed\b|\bsolved\b|\bachieved\b/iu,
  },
  {
    tag: "typing",
    pattern:
      /输入|打字|键盘|文案|写下|写作|文字|代码|编辑|记录|填写|搜索|回复|邮件|短信|消息|笔记|文档|表格|复制|粘贴|敲字|录入|\btype\b|\btyping\b|\bkeyboard\b|\bwrite\b|\bedit\b|\bmessage\b|\bemail\b|\bsearch\b/iu,
  },
  {
    tag: "clock",
    pattern:
      /时间|等待|倒计时|迟到|分钟|小时|秒钟|时钟|闹钟|期限|截止|来不及|马上|立刻|尽快|拖延|延期|准时|提前|过去|未来|每天|早上|晚上|凌晨|\bdeadline\b|\btime\b|\bclock\b|\bwait(?:ing)?\b|\bcountdown\b|\bminute\b|\bhour\b|\bsecond\b|\blate\b/iu,
  },
  {
    tag: "click",
    pattern:
      /点击|单击|双击|按钮|选择|勾选|打开|关闭|设置|菜单|确认|保存|提交|登录|注册|下载|上传|刷新|播放|暂停|删除|返回|下一页|开关|链接|扫码|触发|\bclick\b|\bbutton\b|\bselect\b|\bcheck\b|\bopen\b|\bclose\b|\bsave\b|\bsubmit\b|\blogin\b|\bdownload\b|\bupload\b/iu,
  },
  {
    tag: "impact",
    pattern:
      /重点|关键|突然|必须|真相|注意|核心|千万|震惊|结果|结论|记住|警醒|绝对|根本|本质|致命|严重|巨大|最重要|没想到|万万没想到|真正原因|关键一步|划重点|\bimportant\b|\bkey\b|\bimpact\b|\battention\b|\bcritical\b|\bmust\b|\btruth\b|\bremember\b/iu,
  },
  {
    tag: "pop",
    pattern:
      /出现|弹出|提示|发现|想法|灵感|问题|疑问|原来|答案|提醒|通知|收到|想到|明白|懂了|新消息|冒出来|问号|为什么|怎么做|是什么|真的吗|难道|\bpop\b|\bidea\b|\bdiscover(?:ed|y)?\b|\bquestion\b|\bnotice\b|\bnotify\b|\bremind(?:er)?\b/iu,
  },
  {
    tag: "whoosh",
    pattern:
      /开始|接下来|然后|转向|进入|离开|移动|切换|下一步|最后|转场|跳转|滑动|划过|飞过|冲向|奔跑|穿过|打开新篇章|回到|来到|从此|与此同时|另一方面|镜头一转|\bnext\b|\bmove\b|\bswitch\b|\btransition\b|\bslide\b|\bswipe\b|\benter\b|\bleave\b|\bstart\b|\bfinally\b/iu,
  },
];

function recommendation(
  tag: SoundEffectTag,
  offsetRatio: number,
): StoryboardScene["soundEffects"][number] {
  return {
    tag,
    offsetRatio,
    gainDb: recommendedGainDb[tag],
  };
}

function semanticTag(text: string): SoundEffectTag | undefined {
  const semanticMatch = [...expandedSemanticRules, ...semanticRules].find(
    (rule) => rule.pattern.test(text),
  );
  if (semanticMatch) return semanticMatch.tag;
  if (/[？?]/u.test(text)) return "pop";
  if (/[！!]/u.test(text)) return "impact";
  return undefined;
}

export interface AutomaticSoundEffectScene {
  narration: string;
  subtitle: string;
  soundEffects: StoryboardScene["soundEffects"];
}

/**
 * Adds at most one automatic effect every two visual scenes. Effects already
 * supplied by the storyboard model or edited by the user are preserved.
 */
export function planAutomaticSoundEffects(
  scenes: readonly AutomaticSoundEffectScene[],
): StoryboardScene["soundEffects"][] {
  let lastEffectScene = Number.NEGATIVE_INFINITY;

  return scenes.map((scene, index) => {
    if (scene.soundEffects.length > 0) {
      lastEffectScene = index;
      return scene.soundEffects;
    }

    const tag =
      index === 0
        ? "pop"
        : semanticTag(`${scene.narration}\n${scene.subtitle}`);
    const farEnoughFromPrevious = index - lastEffectScene >= 2;
    const fallbackTransition = index > 0 && index % 2 === 0;

    if (tag && farEnoughFromPrevious) {
      lastEffectScene = index;
      return [
        recommendation(tag, tag === "success" || tag === "error" ? 0.72 : 0.08),
      ];
    }

    if (fallbackTransition && farEnoughFromPrevious) {
      lastEffectScene = index;
      return [recommendation("whoosh", 0.04)];
    }

    return scene.soundEffects;
  });
}

export function applyAutomaticSoundEffects(storyboard: Storyboard): Storyboard {
  const soundEffects = planAutomaticSoundEffects(storyboard.scenes);
  return storyboardSchema.parse({
    ...storyboard,
    scenes: storyboard.scenes.map((scene, index) => ({
      ...scene,
      soundEffects: soundEffects[index] ?? [],
    })),
  });
}

export function soundEffectOffsetMs(
  effect: StoryboardScene["soundEffects"][number],
  sceneDurationSeconds: number,
): number {
  const durationMs = Math.max(1, Math.round(sceneDurationSeconds * 1_000));
  return Math.min(
    Math.max(0, Math.round(effect.offsetRatio * durationMs)),
    Math.max(0, durationMs - 50),
  );
}
