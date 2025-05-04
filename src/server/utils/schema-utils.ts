// src/server/utils/schema-utils.ts
import {
    FunctionDeclarationSchemaType,
    Schema as GeminiSchema,
    FunctionDeclarationSchema
} from '@google/generative-ai';
import logger from '../logger'; // Adjust path to logger

/**
 * Recursively cleans an MCP schema (any object) to conform to the Gemini Schema definition,
 * removing disallowed keys, null/undefined values, and ensuring consistency.
 * Returns the cleaned schema object, a primitive type, or undefined if cleaning fails or results in empty structure.
 */
function cleanSchemaRecursive(schema: any): GeminiSchema | string | number | boolean | undefined {
    if (schema === null || typeof schema !== 'object') {
        // Return primitive values directly, exclude null/undefined
        return (typeof schema === 'string' || typeof schema === 'number' || typeof schema === 'boolean') ? schema : undefined;
    }

    if (Array.isArray(schema)) {
        // Recursively clean items in the array
        const cleanedArray = schema
            .map(item => cleanSchemaRecursive(item))
            .filter(item => item !== undefined); // Remove undefined results
        // Return the cleaned array only if it's not empty
        return cleanedArray.length > 0 ? cleanedArray as any : undefined;
    }

    // Handle objects
    let cleanedSchema: { [key: string]: any } = {};
    for (const key in schema) {
        // Skip disallowed keys at any level
        if (key === '$schema' || key === 'title' || key === 'additionalProperties') {
            continue;
        }

        const value = schema[key];

        // Skip null/undefined values
        if (value === null || value === undefined) {
            continue;
        }

        // Skip 'type: "null"' as it's invalid for Gemini
        if (key === 'type' && value === 'null') {
            logger.trace(`Skipping invalid 'type: null' in schema cleaning for key '${key}'`);
            continue;
        }

        // Recursively clean nested values
        const cleanedValue = cleanSchemaRecursive(value);

        // Add the cleaned value only if it's not undefined
        if (cleanedValue !== undefined) {
            cleanedSchema[key] = cleanedValue;
        }
    }

    // --- Post-cleaning adjustments for the current object level ---

    // Map type string to Gemini enum if present
    if (cleanedSchema.type && typeof cleanedSchema.type === 'string') {
        const typeMap: { [key: string]: FunctionDeclarationSchemaType } = {
            string: FunctionDeclarationSchemaType.STRING,
            number: FunctionDeclarationSchemaType.NUMBER,
            integer: FunctionDeclarationSchemaType.INTEGER,
            boolean: FunctionDeclarationSchemaType.BOOLEAN,
            array: FunctionDeclarationSchemaType.ARRAY,
            object: FunctionDeclarationSchemaType.OBJECT,
        };
        const geminiType = typeMap[cleanedSchema.type.toLowerCase()];
        if (geminiType) {
            cleanedSchema.type = geminiType;
        } else {
            logger.warn(`Unsupported schema type '${cleanedSchema.type}' found during cleaning. Removing type.`);
            delete cleanedSchema.type;
        }
    } else if (cleanedSchema.properties && typeof cleanedSchema.properties === 'object' && !cleanedSchema.type) {
         cleanedSchema.type = FunctionDeclarationSchemaType.OBJECT;
    }

    // Ensure required is an array of strings AND only includes properties that still exist
    if (cleanedSchema.type === FunctionDeclarationSchemaType.OBJECT && cleanedSchema.required) {
        if (Array.isArray(cleanedSchema.required)) {
            const existingProperties = cleanedSchema.properties ? Object.keys(cleanedSchema.properties) : [];
            cleanedSchema.required = cleanedSchema.required.filter(item =>
                typeof item === 'string' && existingProperties.includes(item)
            );
            if (cleanedSchema.required.length === 0) {
                delete cleanedSchema.required;
            }
        } else {
            delete cleanedSchema.required;
        }
    }

    // Validate other fields based on Gemini Schema definition
    if (cleanedSchema.description !== undefined && typeof cleanedSchema.description !== 'string') {
        cleanedSchema.description = String(cleanedSchema.description);
    }
    if (cleanedSchema.format !== undefined && typeof cleanedSchema.format !== 'string') {
        delete cleanedSchema.format;
    }
    if (cleanedSchema.nullable !== undefined && typeof cleanedSchema.nullable !== 'boolean') {
        delete cleanedSchema.nullable;
    }
    if (cleanedSchema.enum !== undefined && (!Array.isArray(cleanedSchema.enum) || !cleanedSchema.enum.every(e => typeof e === 'string'))) {
        delete cleanedSchema.enum;
    }

    // Return undefined if the object became effectively empty (check after cleaning)
    if (Object.keys(cleanedSchema).length === 0) {
        return undefined;
    }

    return cleanedSchema as GeminiSchema;
}

/**
 * Cleans the top-level MCP input schema specifically for Gemini FunctionDeclaration parameters.
 * Ensures the final output conforms to FunctionDeclarationSchema.
 */
export function cleanSchemaForGeminiDeclaration(schema: any): FunctionDeclarationSchema | undefined {
    const cleanedRoot = cleanSchemaRecursive(schema);

    if (!cleanedRoot || typeof cleanedRoot !== 'object' || Array.isArray(cleanedRoot)) {
        logger.warn("Root schema did not clean into a valid object.");
        return undefined;
    }

    // Ensure the final root object conforms to FunctionDeclarationSchema
    const finalSchema: Partial<FunctionDeclarationSchema> = {
        type: FunctionDeclarationSchemaType.OBJECT,
        properties: cleanedRoot.properties as { [k: string]: GeminiSchema } || {},
        description: cleanedRoot.description,
        required: cleanedRoot.required,
    };

    // Remove description/required if they are undefined/empty after cleaning
    if (!finalSchema.description) delete finalSchema.description;
    if (!finalSchema.required) delete finalSchema.required;

    return finalSchema as FunctionDeclarationSchema;
}
