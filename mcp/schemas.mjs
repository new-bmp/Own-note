import { z } from 'zod'

const text = (max = 12000) => z.string().trim().min(1).max(max)
// Keep full Markdown byte-for-byte at the string level, including code indent
// and leading/trailing newlines. A trim transform would lose source content.
const markdown = (max) => z.string().max(max).refine((value) => value.trim().length > 0, '正文不能为空。')
export const id = text(128)
export const target={boardId:id.optional().describe('画布 ID；Agent 项目使用 projectId。'),projectId:id.optional().describe('独立 Agent 项目 ID；不要同时填写不同的 boardId。')}
export const executionSchema=z.object({taskId:id,agentId:id,leaseToken:id,revision:z.string().regex(/^[a-f0-9]{64}$/)}).strict()
export const codeCellSchema=z.object({language:z.enum(['javascript','typescript','python','sql','html','css','json','cpp','c','java','go','rust','csharp','shell','markdown']),code:z.string().max(100000),stdin:z.string().max(64000).default(''),expected:z.string().max(262144).optional()}).strict()
export const webInteractionSchema=z.object({mode:z.enum(['preview','interactive']),approvedOrigin:z.string().url().refine(value=>/^https?:\/\//.test(value),'仅支持 http 或 https 来源').optional(),approvedAt:z.number().finite().optional()}).strict()
export const webInteractionRequestSchema=z.object({mode:z.enum(['preview','interactive'])}).strict()
export const programDriverSchema=z.object({id:id.optional(),name:text(160).optional(),type:z.enum(['tcp','serial-lan','udp','websocket']),host:z.string().max(255).optional(),port:z.number().int().min(1).max(65535).optional(),baudRate:z.number().int().min(300).max(4000000).optional(),encoding:z.enum(['utf8','base64']).default('utf8'),enabled:z.boolean().default(true)}).strict()
export const programFrameSchema=z.object({at:z.number().finite().min(0).max(86400000),values:z.record(z.string().max(120),z.union([z.string().max(2000),z.number().finite(),z.boolean()])).refine(value=>Object.keys(value).length<=100)}).strict()
export const programAnimationSchema=z.object({width:z.number().int().min(1).max(10000),height:z.number().int().min(1).max(10000),durationMs:z.number().int().min(1).max(86400000),loop:z.boolean(),frames:z.array(programFrameSchema).max(1000)}).strict()
export const programAppSchema=z.object({framework:z.literal('flask'),enabled:z.boolean().default(true),entryCellId:id.optional(),port:z.number().int().min(1024).max(65535).optional()}).strict()
export const mediaSettingsSchema=z.object({speed:z.number().min(0.25).max(3),volume:z.number().min(0).max(1),loop:z.boolean(),start:z.number().min(0).max(100000000),marks:z.array(z.object({time:z.number().min(0).max(100000000),label:z.string().max(200)}).strict()).max(200)}).strict()
export const modelSettingsSchema=z.object({wireframe:z.boolean(),grid:z.boolean(),autoRotate:z.boolean()}).strict()
export const analysisSettingsSchema=z.object({filter:z.object({column:z.number().int().min(-1).max(199),operator:z.enum(['contains','equals','greater','less']),value:z.string().max(20000)}).strict().optional(),sort:z.object({column:z.number().int().min(-1).max(199),ascending:z.boolean()}).strict().optional(),group:z.number().int().min(0).max(199).optional(),value:z.number().int().min(0).max(199).optional(),method:z.enum(['sum','mean','count']).optional(),chartType:z.enum(['bar','line','pie']).optional(),order:z.enum(['source','value','label']).optional()}).strict()
export const color = z.string().regex(/^#[\da-f]{6}$/i)
export const action = z
  .object({
    text: text(2000),
    done: z.boolean().default(false),
    owner: text(120).optional(),
    priority: z.enum(['high', 'medium', 'low']).optional(),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict()
export const chartSchema = z
  .object({
    type: z.enum(['bar', 'line', 'pie']),
    labels: z.array(text(120)).min(1).max(60),
    series: z
      .array(
        z
          .object({
            name: text(120),
            values: z
              .array(z.number().finite().min(-1e15).max(1e15))
              .min(1)
              .max(60),
            color: color.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(6),
    unit: text(40).optional(),
  })
  .strict()
export const provenance = z
  .object({
    agent: text(120).optional(),
    conversationId: id.optional(),
    url: z
      .string()
      .url()
      .refine(
        (value) => /^(https?:|codex:)/.test(value),
        '来源链接支持 http、https 或 codex',
      )
      .optional(),
  })
  .strict()
export const addBase = {
  ...target,
  execution: executionSchema.optional(),
  requestId: id.describe(
    '本次操作的幂等 ID；重试时保持不变，新的写入使用新 ID。',
  ),
  title: text(200),
  caption: text(4000).optional(),
  color: color.optional(),
}
export const conversationSchema = z
  .object({
    requestId: addBase.requestId,
    ...target,
    execution:executionSchema.optional(),
    title: text(200),
    summary: text(6000).describe(
      '2–4 句话概述目标、进展和结果。摘要只是导读；完整整理还须提供 markdown 或详细 sections，不要把正文压缩成摘要。',
    ),
    markdown: markdown(200000).optional().describe(
      '推荐：完整的整理正文，最多 200000 字符。保留背景、用户约束、方案与依据、具体步骤、代码、表格、数值、参考及未完成事项，用 Markdown 标题组织。服务按完整块自动拆卡并保留原稿，不会替你补全遗漏。与 sections 二选一即可；结构化 actions/图等可另附。',
    ),
    sections: z
      .array(z.object({ title: text(200), markdown: markdown(100000) }).strict())
      .max(64)
      .default([])
      .describe('完整正文的另一种传法：按章节传入全部细节，服务自动拆分长章节；不要只传章节标题。若已用 markdown 则无需重复。'),
    decisions: z
      .array(
        z
          .object({ decision: text(2000), reason: text(4000).optional() })
          .strict(),
      )
      .max(30)
      .default([])
      .describe('会话中已确认的决定及理由，不把建议当成决定。'),
    actions: z.array(action).max(80).default([]).describe('需要执行的任务；保留完成状态，负责人、日期不明确时省略。'),
    openQuestions: z.array(text(2000)).max(30).default([]).describe('尚未解决的问题、风险和待验证假设。'),
    references: z
      .array(
        z
          .object({
            title: text(200),
            url: z
              .string()
              .url()
              .refine((value) => /^(https?:|codex:)/.test(value)),
          })
          .strict(),
      )
      .max(30)
      .default([]),
    equations: z
      .array(
        z
          .object({
            title: text(200),
            latex: text(12000),
            explanation: text(4000).optional(),
          })
          .strict(),
      )
      .max(8)
      .default([]),
    diagrams: z
      .array(
        z
          .object({
            title: text(200),
            mermaid: text(20000),
            caption: text(4000).optional(),
          })
          .strict(),
      )
      .max(8)
      .default([]),
    charts: z
      .array(
        z
          .object({
            title: text(200),
            chart: chartSchema,
            caption: text(4000).optional(),
          })
          .strict(),
      )
      .max(8)
      .default([]),
    source: provenance.optional(),
    transcript: markdown(100000)
      .optional()
      .describe('可选原文摘录。只在用户需要时提供，不保存隐藏提示或秘密。'),
  })
  .strict()
