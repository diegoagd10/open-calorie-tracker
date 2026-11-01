import { Injectable, NotFoundException } from '@nestjs/common'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from '@modelcontextprotocol/sdk/types.js'
import {
  type ApiScope,
  ENTRY_NOT_FOUND_MESSAGE,
  INSUFFICIENT_SCOPE_MESSAGE,
  createFoodEntrySchema,
  createWaterEntrySchema,
  foodEntrySchema,
  servingSizeSchema,
  waterEntrySchema,
} from '@open-calorie-tracker/shared'
import { z } from 'zod'
import type { TokenSubject } from '../auth/auth.service.js'
import { DailyLogService } from '../daily-log/daily-log.service.js'
import { dayQuerySchema } from '../daily-log/day.js'
import { FoodEntriesService } from '../food-entries/food-entries.service.js'
import { ServingSizesService } from '../serving-sizes/serving-sizes.service.js'
import { WaterEntriesService } from '../water-entries/water-entries.service.js'

// A tool runs for the user the request authenticated, with input its schema already parsed. It
// answers a JSON object, which becomes the tool's structured result.
type Tool = {
  name: string
  description: string
  // The scopes a token needs for the tool to be listed and called.
  scopes: ApiScope[]
  input: z.ZodType
  run: (userId: number, input: never) => Promise<object>
}

const tool = <S extends z.ZodType>(definition: {
  name: string
  description: string
  scopes: ApiScope[]
  input: S
  run: (userId: number, input: z.output<S>) => Promise<object>
}): Tool => definition

const entryId = z.number().int().positive()

// What log_food and update_food_entry take: a food per serving with its serving size by name, which
// is found or added like POST /v1/serving-sizes does.
const foodFields = foodEntrySchema
  .omit({ servingSizeId: true })
  .extend({ servingSize: servingSizeSchema.shape.name })

const UNITS =
  'Calories are in kcal, sodium in mg, every other nutrient in g, and water in US fluid ounces.'

const textOf = (structured: object): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(structured) }],
  structuredContent: structured as Record<string, unknown>,
})

const errorOf = (message: string): CallToolResult => ({
  content: [{ type: 'text', text: message }],
  isError: true,
})

// The MCP server AI assistants reach at /v1/mcp. Every tool calls the same services as the REST API.
@Injectable()
export class McpService {
  private readonly tools: Tool[]

  constructor(
    dailyLog: DailyLogService,
    foodEntries: FoodEntriesService,
    waterEntries: WaterEntriesService,
    servingSizes: ServingSizesService,
  ) {
    const servingSizeIdOf = async (userId: number, name: string) =>
      (await servingSizes.findOrCreate(userId, { name })).servingSize.id

    this.tools = [
      tool({
        name: 'get_daily_log',
        description: `The user's food and water entries, totals and daily goals for one calendar day in their time zone, newest entry first. ${UNITS}`,
        scopes: ['daily-log:read'],
        input: dayQuerySchema,
        run: (userId, day) => dailyLog.dailyLog(userId, day),
      }),
      tool({
        name: 'log_food',
        description: `Logs a food the user ate, with its calories and nutrients per serving as the label prints them and how many servings (0.5 to 20, in steps of 0.5). Leave out the nutrients the label does not give. loggedAt is when they ate it, now when left out. ${UNITS}`,
        scopes: ['food-entries:write', 'serving-sizes:write'],
        input: foodFields.extend({ loggedAt: createFoodEntrySchema.shape.loggedAt }),
        run: async (userId, { servingSize, ...input }) =>
          foodEntries.create(userId, {
            ...input,
            servingSizeId: await servingSizeIdOf(userId, servingSize),
          }),
      }),
      tool({
        name: 'get_food_entry',
        description: `One food entry, with its calories and nutrients per serving. ${UNITS}`,
        scopes: ['food-entries:read'],
        input: z.strictObject({ id: entryId }),
        run: (userId, { id }) => foodEntries.find(userId, id),
      }),
      tool({
        name: 'update_food_entry',
        description: `Replaces every field of a food entry, per serving like log_food. The entry keeps the time it was logged at. ${UNITS}`,
        scopes: ['food-entries:write', 'serving-sizes:write'],
        input: foodFields.extend({ id: entryId }),
        run: async (userId, { id, servingSize, ...input }) => {
          // Fails before adding the serving size when the entry is not the user's.
          await foodEntries.find(userId, id)
          return foodEntries.update(userId, id, {
            ...input,
            servingSizeId: await servingSizeIdOf(userId, servingSize),
          })
        },
      }),
      tool({
        name: 'delete_food_entry',
        description: 'Deletes a food entry.',
        scopes: ['food-entries:write'],
        input: z.strictObject({ id: entryId }),
        run: async (userId, { id }) => {
          await foodEntries.remove(userId, id)
          return { id, deleted: true }
        },
      }),
      tool({
        name: 'log_water',
        description:
          'Logs water the user drank, in US fluid ounces (a glass is 8). loggedAt is when they drank it, now when left out.',
        scopes: ['water-entries:write'],
        input: createWaterEntrySchema,
        run: (userId, input) => waterEntries.create(userId, input),
      }),
      tool({
        name: 'get_water_entry',
        description: 'One water entry, in US fluid ounces.',
        scopes: ['water-entries:read'],
        input: z.strictObject({ id: entryId }),
        run: (userId, { id }) => waterEntries.find(userId, id),
      }),
      tool({
        name: 'update_water_entry',
        description:
          'Changes the amount of a water entry, in US fluid ounces. The entry keeps the time it was logged at.',
        scopes: ['water-entries:write'],
        input: waterEntrySchema.extend({ id: entryId }),
        run: (userId, { id, ...input }) => waterEntries.update(userId, id, input),
      }),
      tool({
        name: 'delete_water_entry',
        description: 'Deletes a water entry.',
        scopes: ['water-entries:write'],
        input: z.strictObject({ id: entryId }),
        run: async (userId, { id }) => {
          await waterEntries.remove(userId, id)
          return { id, deleted: true }
        },
      }),
      tool({
        name: 'list_serving_sizes',
        description: "The user's serving sizes, alphabetically.",
        scopes: ['serving-sizes:read'],
        input: z.strictObject({}),
        run: async (userId) => ({ servingSizes: await servingSizes.list(userId) }),
      }),
      tool({
        name: 'create_serving_size',
        description:
          'Adds a serving size, like "1 cup", or returns the one the user already has with that name regardless of case.',
        scopes: ['serving-sizes:write'],
        input: servingSizeSchema,
        run: async (userId, input) => (await servingSizes.findOrCreate(userId, input)).servingSize,
      }),
    ]
  }

  // A server for one request, which lists and runs the tools the subject's scopes cover.
  serverFor({ userId, scopes = [] }: TokenSubject): Server {
    const allowed = (tool: Tool) => tool.scopes.every((scope) => scopes.includes(scope))
    const server = new Server(
      { name: 'open-calorie-tracker', version: '0.0.1' },
      { capabilities: { tools: {} } },
    )

    server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: this.tools.filter(allowed).map(({ name, description, input }) => ({
        name,
        description,
        inputSchema: z.toJSONSchema(input, { io: 'input' }) as { type: 'object' },
      })),
    }))

    server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
      const tool = this.tools.find((candidate) => candidate.name === params.name)
      if (tool === undefined) {
        throw new McpError(ErrorCode.InvalidParams, `Unknown tool ${params.name}`)
      }
      if (!allowed(tool)) return errorOf(INSUFFICIENT_SCOPE_MESSAGE)

      const parsed = tool.input.safeParse(params.arguments ?? {})
      if (!parsed.success) {
        return errorOf(parsed.error.issues.map((issue) => issue.message).join('\n'))
      }

      try {
        return textOf(await tool.run(userId, parsed.data as never))
      } catch (error) {
        if (error instanceof NotFoundException) return errorOf(ENTRY_NOT_FOUND_MESSAGE)
        throw error
      }
    })

    return server
  }
}
