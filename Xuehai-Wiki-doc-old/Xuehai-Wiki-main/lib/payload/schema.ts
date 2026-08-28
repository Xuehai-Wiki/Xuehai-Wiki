/**
 * JSON Schema definition for payload validation
 */
export const payloadSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  required: ['global'],
  properties: {
    global: {
      type: 'object',
      required: ['title', 'description'],
      properties: {
        title: { type: 'string', minLength: 1 },
        description: { type: 'string', minLength: 1 },
        favicon: { type: 'string' },
        lang: { type: 'string', minLength: 2 },
        baseUrl: { type: 'string', format: 'uri' },
        repoUrl: { type: 'string', format: 'uri' },
        urlStrategy: { type: 'string', enum: ['path', 'hash'] },
        autoNavigation: { type: 'boolean' },
        seo: {
          type: 'object',
          properties: {
            openGraph: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                description: { type: 'string' },
                images: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['url'],
                    properties: {
                      url: { type: 'string' },
                      width: { type: 'number' },
                      height: { type: 'number' },
                      alt: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    navigation: {
      type: 'array',
      items: {
        $ref: '#/definitions/navigationItem',
      },
    },
    theme: {
      type: 'object',
      properties: {
        primary: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' },
        secondary: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' },
        background: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' },
        text: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' },
        sidebarBg: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' },
        codeBg: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' },
      },
    },
  },
  definitions: {
    navigationItem: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', minLength: 1 },
        path: { type: 'string' },
        icon: { type: 'string' },
        color: { type: 'string' },
        hidden: { type: 'boolean' },
        children: {
          type: 'array',
          items: { $ref: '#/definitions/navigationItem' },
        },
      },
    },
  },
};
