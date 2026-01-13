/* eslint-disable no-console -- CLI outputs user-facing messages */
// ux/command_handler.ts
/**
 * Command Handler for MOVA Agent
 * Provides a stable UX layer with consistent command interface
 */

interface Command {
  name: string;
  description: string;
  options: CommandOption[];
  handler: (args: any) => Promise<any>;
}

interface CommandOption {
  name: string;
  alias?: string;
  description: string;
  required?: boolean;
  type: 'string' | 'number' | 'boolean';
}

class CommandHandler {
  private commands: Map<string, Command> = new Map();

  /**
   * Register a new command
   */
  registerCommand(command: Command): void {
    this.commands.set(command.name, command);

    // Also register with alias if available
    if (command.options) {
      for (const option of command.options) {
        if (option.alias) {
          // Store alias mapping if needed
        }
      }
    }
  }

  /**
   * Parse and execute command from raw input
   */
  async executeCommand(input: string): Promise<any> {
    // Simple parsing - in reality would use proper CLI parsing library
    const args = this.parseArguments(input);
    const commandName = args._[0];

    const command = this.commands.get(commandName);
    if (!command) {
      throw new Error(`Unknown command: ${commandName}`);
    }

    // Validate required options
    if (command.options) {
      for (const option of command.options) {
        if (option.required && args[option.name] === undefined) {
          throw new Error(`Missing required option: --${option.name}`);
        }
      }
    }

    // Execute the command handler
    return await command.handler(args);
  }

  async executeCommandFromArgv(argv: string[]): Promise<any> {
    const commandName = argv[0];
    const command = this.commands.get(commandName);
    if (!command) {
      throw new Error(`Unknown command: ${commandName}`);
    }

    const args: any = { _: [commandName] };
    for (let i = 1; i < argv.length; i++) {
      const arg = argv[i];
      if (arg.startsWith('--')) {
        const key = arg.substring(2);
        if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
          args[key] = this.parseValue(argv[i + 1]);
          i++;
        } else {
          args[key] = true;
        }
      } else if (arg.startsWith('-')) {
        const key = arg.substring(1);
        if (
          command.options.find((o) => o.alias === key) &&
          i + 1 < argv.length &&
          !argv[i + 1].startsWith('-')
        ) {
          args[key] = this.parseValue(argv[i + 1]);
          i++;
        } else {
          args[key] = true;
        }
      }
    }

    // map alias to name
    if (command.options) {
      for (const option of command.options) {
        if (option.alias && args[option.alias]) {
          args[option.name] = args[option.alias];
          delete args[option.alias];
        }
      }
    }

    // Validate required options
    if (command.options) {
      for (const option of command.options) {
        if (option.required && args[option.name] === undefined) {
          throw new Error(`Missing required option: --${option.name}`);
        }
      }
    }

    // Execute the command handler
    return await command.handler(args);
  }

  /**
   * Parse command line arguments
   */
  private parseArguments(input: string): any {
    const args: any = { _: [] };
    const tokens = this.tokenize(input);

    let currentKey = null;
    for (const token of tokens) {
      if (token.startsWith('--')) {
        currentKey = token.substring(2);
        args[currentKey] = true; // default value
      } else if (token.startsWith('-') && token.length > 1) {
        // Handle short options like -v
        const key = token.substring(1);
        args[key] = true;
      } else {
        // Value assignment
        if (currentKey) {
          args[currentKey] = this.parseValue(token);
          currentKey = null;
        } else {
          // Positional argument
          args._.push(token);
        }
      }
    }

    return args;
  }

  /**
   * Tokenize input string considering quotes
   */
  private tokenize(input: string): string[] {
    const tokens: string[] = [];
    let currentToken = '';
    let inQuotes = false;
    let quoteChar = '';

    for (let i = 0; i < input.length; i++) {
      const char = input[i];

      if ((char === '"' || char === "'") && !inQuotes) {
        inQuotes = true;
        quoteChar = char;
      } else if (char === quoteChar && inQuotes) {
        inQuotes = false;
        quoteChar = '';
      } else if (char === ' ' && !inQuotes) {
        if (currentToken) {
          tokens.push(currentToken);
          currentToken = '';
        }
      } else {
        currentToken += char;
      }
    }

    if (currentToken) {
      tokens.push(currentToken);
    }

    return tokens;
  }

  /**
   * Parse values to appropriate types
   */
  private parseValue(value: string): any {
    // Check for numeric values
    if (/^-?\d+$/.test(value)) {
      return parseInt(value, 10);
    }

    if (/^-?\d*\.\d+$/.test(value)) {
      return parseFloat(value);
    }

    // Check for booleans
    if (value.toLowerCase() === 'true') {
      return true;
    }

    if (value.toLowerCase() === 'false') {
      return false;
    }

    // Return as string
    return value;
  }

  /**
   * Get help text for a command or all commands
   */
  getHelp(commandName?: string): string {
    if (commandName) {
      const command = this.commands.get(commandName);
      if (!command) {
        return `Command '${commandName}' not found.`;
      }

      let helpText = `${command.description}\n\n`;
      helpText += `Usage: ${commandName}`;

      if (command.options) {
        for (const option of command.options) {
          const aliasPart = option.alias ? `-${option.alias}, ` : '';
          const requiredMarker = option.required ? '*' : '';
          helpText += `\n  ${aliasPart}--${option.name}${requiredMarker}\t${option.description}`;
        }
      }

      return helpText;
    } else {
      let helpText = 'Available commands:\n';
      for (const [name, command] of this.commands.entries()) {
        helpText += `\n${name}\t${command.description}`;
      }
      helpText += '\n\nUse "help <command>" for detailed information about a specific command.';
      return helpText;
    }
  }

  /**
   * List all registered commands
   */
  listCommands(): string[] {
    return Array.from(this.commands.keys());
  }
}

// ux/cli_interface.ts
/**
 * CLI Interface for MOVA Agent
 * Provides the main entry points for command-line operations
 */

import { SkillsLayer } from '../skills/skills_layer';
import { Interpreter } from '../interpreter/interpreter';

class CLIInterface {
  private commandHandler: CommandHandler;
  private skillsLayer: SkillsLayer;
  private interpreter: Interpreter;

  constructor() {
    this.commandHandler = new CommandHandler();
    this.skillsLayer = new SkillsLayer();
    this.interpreter = new Interpreter();
    this.registerCommands();
  }

  /**
   * Register all available commands
   */
  private registerCommands(): void {
    // Plan command - creates a plan from a goal
    this.commandHandler.registerCommand({
      name: 'plan',
      description: 'Create an execution plan from a high-level goal',
      options: [
        { name: 'goal', description: 'The goal to achieve', required: true, type: 'string' },
        { name: 'output', alias: 'o', description: 'Output file for the plan', type: 'string' },
      ],
      handler: async (args: any) => {
        const goal = args.goal;
        if (!goal) {
          throw new Error('Goal is required for plan command');
        }

        // Use the skills layer to create a plan
        const result = await this.skillsLayer.executeSkill('plan', {
          goal,
          available_tools: ['http', 'noop', 'restricted_shell'],
        });

        // Optionally save to file
        if (args.output) {
          const fs = require('fs-extra');
          await fs.writeJson(args.output, result.plan, { spaces: 2 });
          console.log(`Plan saved to ${args.output}`);
        }

        return result;
      },
    });

    // Explain command - explains a plan or execution result
    this.commandHandler.registerCommand({
      name: 'explain',
      description: 'Explain how a plan works or why it failed',
      options: [
        { name: 'query', description: 'What to explain', required: true, type: 'string' },
        { name: 'plan', description: 'Plan file or JSON string to explain', type: 'string' },
        { name: 'result', description: 'Execution result to explain', type: 'string' },
      ],
      handler: async (args: any) => {
        const query = args.query;
        if (!query) {
          throw new Error('Query is required for explain command');
        }

        // Load plan if specified (can be a file path or JSON string)
        let plan = null;
        if (args.plan) {
          const fs = require('fs-extra');

          // Check if args.plan looks like a JSON string
          if (typeof args.plan === 'string' && args.plan.trim().startsWith('{')) {
            try {
              plan = JSON.parse(args.plan);
            } catch (error: any) {
              throw new Error(`Invalid JSON in plan argument: ${error.message}`);
            }
          }
          // Otherwise treat as file path
          else {
            try {
              plan = await fs.readJson(args.plan);
            } catch (error: any) {
              throw new Error(`Could not read plan file "${args.plan}": ${error.message}`);
            }
          }
        }

        // Call the explanation service
        const explanationRequest: any = {
          plan,
          query,
        };

        // If result file is provided, add execution context
        if (args.result) {
          const fs = require('fs-extra');

          // Check if args.result looks like a JSON string
          if (typeof args.result === 'string' && args.result.trim().startsWith('{')) {
            try {
              explanationRequest.execution_results = JSON.parse(args.result);
            } catch (error: any) {
              throw new Error(`Invalid JSON in result argument: ${error.message}`);
            }
          }
          // Otherwise treat as file path
          else {
            try {
              explanationRequest.execution_results = await fs.readJson(args.result);
            } catch (error: any) {
              throw new Error(`Could not read result file "${args.result}": ${error.message}`);
            }
          }
        }

        return await this.skillsLayer.executeSkill('explain', explanationRequest);
      },
    });

    // Execute command - runs a plan
    this.commandHandler.registerCommand({
      name: 'execute',
      description: 'Execute a plan',
      options: [
        {
          name: 'plan',
          alias: 'p',
          description: 'Plan file to execute',
          required: true,
          type: 'string',
        },
        { name: 'token-budget', description: 'Path to token budget file', type: 'string' },
        {
          name: 'token-budget-profile',
          description: 'Profile to use from token budget file',
          type: 'string',
        },
        {
          name: 'dry-run',
          description: 'Show what would be executed without running',
          type: 'boolean',
        },
      ],
      handler: async (args: any) => {
        const planFile = args.plan;
        if (!planFile) {
          throw new Error('Plan file is required for execute command');
        }

        const fs = require('fs-extra');
        const plan = await fs.readJson(planFile);

        if (args['dry-run']) {
          console.log('Dry run mode - would execute plan:');
          console.log(JSON.stringify(plan, null, 2));
          return { dryRun: true, plan };
        }

        const toolPool = await fs.readJson('default_tool_pool.json');
        const instructionProfile = await fs.readJson('default_instruction_profile.json');

        // Execute the plan using the interpreter
        return await this.interpreter.runPlan({
          planEnvelope: plan,
          toolPool,
          instructionProfile,
          tokenBudgetPath: args['token-budget'],
          tokenBudgetProfile: args['token-budget-profile'],
        });
      },
    });

    // Repair command - attempts to fix a failing plan
    this.commandHandler.registerCommand({
      name: 'repair',
      description: 'Attempt to repair a failing plan',
      options: [
        {
          name: 'plan',
          description: 'Failing plan file to repair',
          required: true,
          type: 'string',
        },
        {
          name: 'result',
          description: 'Execution result with error details',
          required: true,
          type: 'string',
        },
      ],
      handler: async (args: any) => {
        const planFile = args.plan;
        const resultFile = args.result;

        if (!planFile || !resultFile) {
          throw new Error('Both plan and result files are required for repair command');
        }

        const fs = require('fs-extra');
        const plan = await fs.readJson(planFile);
        const result = await fs.readJson(resultFile);

        return await this.skillsLayer.executeSkill('repair', {
          failed_plan: plan,
          failure_context: result.context || {},
          error_details: result.error || result.message || 'Unknown error',
        });
      },
    });

    // Help command - shows help information
    this.commandHandler.registerCommand({
      name: 'help',
      description: 'Show help information',
      options: [
        { name: 'command', description: 'Specific command to get help for', type: 'string' },
      ],
      handler: async (args: any) => {
        return this.commandHandler.getHelp(args.command);
      },
    });
  }

  /**
   * Process a command input string
   */
  async processCommand(input: string): Promise<any> {
    try {
      return await this.commandHandler.executeCommand(input);
    } catch (error: any) {
      // Format error message for CLI output
      return {
        error: true,
        message: error.message,
        command: input,
      };
    }
  }

  /**
   * Get help for specific command or general help
   */
  getHelp(commandName?: string): string {
    return this.commandHandler.getHelp(commandName);
  }

  /**
   * Get list of available commands
   */
  listCommands(): string[] {
    return this.commandHandler.listCommands();
  }

  /**
   * Main run method to handle command line arguments
   */
  async run(argv: string[]): Promise<void> {
    if (argv.length === 0) {
      // Show help if no arguments provided
      console.log(this.commandHandler.getHelp());
      return;
    }

    // Check for help flag
    if (argv.includes('--help') || argv.includes('-h')) {
      const commandName = argv.find(
        (arg) => arg !== '--help' && arg !== '-h' && !arg.startsWith('-')
      );
      console.log(this.commandHandler.getHelp(commandName));
      return;
    }

    // Check for version flag
    if (argv.includes('--version') || argv.includes('-v')) {
      const packageJson = require('../../package.json');
      console.log(packageJson.version);
      return;
    }

    // Handle the 'run' command specifically for MOVA agent execution
    if (argv[0] === 'run') {
      await this.handleRunCommand(argv.slice(1));
      return;
    }

    const result = await this.commandHandler.executeCommandFromArgv(argv);

    if (result.error) {
      console.error('Error:', result.message);
      process.exit(1);
    } else {
      console.log('Success:', JSON.stringify(result, null, 2));
    }
  }

  /**
   * Handle the 'run' command specifically for MOVA agent execution
   */
  private async handleRunCommand(args: string[]): Promise<void> {
    // Parse arguments for the run command
    const parsedArgs: any = {};
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--goal' && i + 1 < args.length) {
        parsedArgs.goal = args[i + 1];
        i++;
      } else if (args[i] === '--tool-pool' && i + 1 < args.length) {
        parsedArgs.toolPool = args[i + 1];
        i++;
      } else if (args[i] === '--profile' && i + 1 < args.length) {
        parsedArgs.profile = args[i + 1];
        i++;
      }
    }

    if (!parsedArgs.goal) {
      console.error('Error: --goal is required for run command');
      process.exit(1);
    }

    if (!parsedArgs.toolPool) {
      console.error('Error: --tool-pool is required for run command');
      process.exit(1);
    }

    if (!parsedArgs.profile) {
      console.error('Error: --profile is required for run command');
      process.exit(1);
    }

    // Import required modules
    const fs = require('fs-extra');
    const path = require('path');
    const interpreterModule = require('../interpreter/interpreter');
    const { Interpreter } = interpreterModule;

    try {
      // Load the tool pool and instruction profile
      const toolPoolPath = path.resolve(parsedArgs.toolPool);
      const profilePath = path.resolve(parsedArgs.profile);

      const toolPool = await fs.readJson(toolPoolPath);
      const instructionProfile = await fs.readJson(profilePath);

      // Create a plan based on the goal
      const planEnvelope = await this.createPlanFromGoal(parsedArgs.goal);

      // Initialize the interpreter and run the plan
      const interpreter = new Interpreter();
      const result = await interpreter.runPlan({
        planEnvelope,
        toolPool,
        instructionProfile,
      });

      if (result.success) {
        console.log('Run completed successfully');
        process.exit(0);
      } else {
        console.error('Run failed:', result.error);
        // Ensure evidence is still written even on failure
        if (result.run_summary) {
          console.log('Run summary:', JSON.stringify(result.run_summary, null, 2));
        }
        process.exit(1);
      }
    } catch (error: any) {
      console.error('Run command failed:', error.message);
      process.exit(1);
    }
  }

  /**
   * Create a plan from a goal (for testing purposes)
   */
  private async createPlanFromGoal(goal: string): Promise<any> {
    // For testing purposes, create a simple plan based on the goal
    if (goal.includes('noop-only')) {
      // Create a plan with only noop steps
      return {
        verb: 'execute',
        subject_ref: 'user_request',
        object_ref: 'plan_execution',
        payload: {
          steps: [
            {
              id: 'step-1',
              verb: 'noop',
              connector_id: 'noop_connector_1',
              input: { message: 'noop-only step' },
              tool_binding: {
                driver_kind: 'noop',
                limits: {
                  timeout_ms: 1000,
                  max_data_size: 10240,
                },
              },
            },
          ],
        },
      };
    } else if (goal.includes('http')) {
      // Create a plan with an HTTP step
      return {
        verb: 'execute',
        subject_ref: 'user_request',
        object_ref: 'plan_execution',
        payload: {
          steps: [
            {
              id: 'step-1',
              verb: 'http',
              connector_id: 'http_connector_1',
              input: {
                url: 'https://api.example.com/data',
                method: 'GET',
              },
              tool_binding: {
                driver_kind: 'http',
                destination_allowlist: ['https://api.example.com'],
                limits: {
                  timeout_ms: 5000,
                  max_data_size: 102400,
                },
              },
            },
          ],
        },
      };
    } else {
      // Default plan
      return {
        verb: 'execute',
        subject_ref: 'user_request',
        object_ref: 'plan_execution',
        payload: {
          steps: [
            {
              id: 'step-1',
              verb: 'noop',
              connector_id: 'noop_connector_1',
              input: { message: 'default step' },
              tool_binding: {
                driver_kind: 'noop',
                limits: {
                  timeout_ms: 1000,
                  max_data_size: 10240,
                },
              },
            },
          ],
        },
      };
    }
  }
}

export { CommandHandler, CLIInterface };
