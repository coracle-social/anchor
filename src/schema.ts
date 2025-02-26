export class SchemaType {
  constructor(readonly name: string) {}

  static from(name: string) {
    return new SchemaType(name)
  }

  toString() {
    return this.name
  }
}

export type Schema = {
  t: SchemaType
  enum?: any[]
  items?: Schema
  properties?: Record<string, Schema>
  required?: string[]
  closed?: boolean
}

export type ChildTuple = [Schema, any, string]

export enum SchemaErrorCode {
  MissingProperty = 'missing-property',
  ExtraProperty = 'extra-property',
  TypeError = 'type-error',
  Enum = 'enum',
}

export type SchemaError = {
  path: string[]
  code: SchemaErrorCode
  expected: string
  actual: string
  message: string
}

export type TypeOptions = {
  typeIsValid: (data: any) => boolean
  iterChildTuples?: (schema: Schema, data: any) => Iterable<ChildTuple>
  iterTypeErrors?: (schema: Schema, data: any, path: string[]) => Iterable<SchemaError>
}

export const registry = new Map<string, TypeOptions & { name: string }>()

export function defineType(name: string, options: TypeOptions) {
  registry.set(name, { name, ...options })

  return SchemaType.from(name)
}

export const ANY = defineType('any', { typeIsValid: (_: any) => true })

export const NIL = defineType('nil', { typeIsValid: (v: any) => v === undefined })

export const INT = defineType('int', {
  typeIsValid: (v: any) => typeof v === 'number' && Math.round(v) === v,
})

export const NUM = defineType('num', { typeIsValid: (v: any) => typeof v === 'number' })

export const STR = defineType('str', { typeIsValid: (v: any) => typeof v === 'string' })

export const BOOL = defineType('bool', { typeIsValid: (v: any) => typeof v === 'boolean' })

export const TRUE = defineType('true', { typeIsValid: (v: any) => v === true })

export const FALSE = defineType('false', { typeIsValid: (v: any) => v === false })

export const LIST = defineType('list', {
  typeIsValid: (v: any) => Array.isArray(v),
  iterChildTuples: function* (schema: Schema, data: any[]) {
    const childSchema = schema.items || { t: ANY }

    for (let i = 0; i < data.length; i++) {
      yield [childSchema, data[i], String(i)]
    }
  },
})

export const MAP = defineType('map', {
  typeIsValid: (v: any) => typeof v === 'object',
  iterChildTuples: function* (schema: Schema, data: Record<string, any>) {
    const entries = Object.entries(schema.properties || {})

    for (let i = 0; i < entries.length; i++) {
      const [k, childSchema] = entries[i]

      if (data[k]) {
        yield [childSchema, data[k], k]
      }
    }
  },
  iterTypeErrors: function* (schema: Schema, data: Record<string, any>, path: string[]) {
    for (const k of schema.required || []) {
      if (data[k] === undefined) {
        yield {
          path: [...path, k],
          code: SchemaErrorCode.MissingProperty,
          expected: String(schema.properties?.[k].t),
          actual: getType(data[k]),
          message: `${k} is a required property`,
        }
      }
    }

    if (schema.closed) {
      for (const [k, v] of Object.entries(data)) {
        if (!schema.properties?.[k]) {
          yield {
            path: [...path, k],
            code: SchemaErrorCode.ExtraProperty,
            expected: String(NIL),
            actual: getType(v),
            message: `${k} is not an allowed property`,
          }
        }
      }
    }
  },
})

// Display functions

const summarize = (data: any) => JSON.stringify(data)

const getType = (data: any) => {
  if (Array.isArray(data)) return 'list'

  switch (typeof data) {
    case 'undefined':
      return 'nil'
    case 'number':
      return Math.round(data) === data ? 'int' : 'num'
    case 'string':
      return 'str'
    case 'boolean':
      return 'bool'
    case 'object':
      return 'map'
  }

  return typeof data
}

// Normalize

export type RawSchema<T = any> = string | Schema | SchemaType | T[] | Record<string, T>

export function normalize(schema: RawSchema): Schema {
  // If it's just a type keyword turn it into an object
  if (schema instanceof SchemaType) return { t: schema }

  // If it's a schema we're good
  if ((schema as Schema).t instanceof SchemaType) return schema as Schema

  // If we have a string, check the registry
  if (registry.has(schema as string)) return { t: SchemaType.from(schema as string) }

  // Arrays are a special case
  if (Array.isArray(schema) && schema.length === 1) {
    return { t: LIST, items: normalize(schema[0]) }
  }

  // Objects are a special case
  if (typeof schema === 'object') {
    const properties: Record<string, Schema> = {}

    for (const [k, v] of Object.entries(schema)) {
      properties[k] = normalize(v)
    }

    return { t: MAP, properties }
  }

  throw new Error(`Invalid schema: ${summarize(schema)}`)
}

// Data validation utils

export function* iterErrors(
  rawSchema: RawSchema,
  data: any,
  path: string[] = []
): Iterable<SchemaError> {
  const schema = normalize(rawSchema)
  const typedef = registry.get(schema.t.toString())

  if (!typedef) {
    throw new Error(`No definition registered for ${schema.t.toString()}`)
  }

  if (!typedef.typeIsValid(data)) {
    yield {
      path,
      code: SchemaErrorCode.TypeError,
      expected: String(schema.t),
      actual: getType(data),
      message: `${summarize(data)} is not a ${schema.t.toString()}`,
    }
  }

  if (schema.enum && !schema.enum.some((x) => x === data)) {
    yield {
      path,
      code: SchemaErrorCode.Enum,
      expected: String(schema.t),
      actual: getType(data),
      message: `${summarize(data)} is not one of ${summarize(schema.enum)}`,
    }
  }

  if (typedef.iterTypeErrors) {
    yield* typedef.iterTypeErrors(schema, data, path)
  }

  if (typedef.iterChildTuples) {
    for (const [childSchema, child, k] of typedef.iterChildTuples(schema, data)) {
      yield* iterErrors(childSchema, child, [...path, k])
    }
  }
}

export function getError(rawSchema: RawSchema, data: any, path = []) {
  for (const error of iterErrors(rawSchema, data, path)) {
    return error
  }
}
