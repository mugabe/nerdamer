import {Token} from './Token';
import {isNumber, remove} from '../Core/Utils';
import {Math2} from '../Core/Math2';
import {Settings} from '../Settings';
import {Bracket, Brackets, OperatorDictionary} from './OperatorDictionary';
import {Node} from './Node';
import {FunctionProvider} from '../Operators/functions';
import {PreprocessorError} from '../Core/Errors';

class ParityError extends Error {
    name = 'ParityError';
}

type PreprocessorAction = (expression: string) => string;
type Preprocessors = { names: (string|undefined)[], actions: (PreprocessorAction|undefined)[] };

export class Tokenizer {
    // dependencies
    // private readonly deps: TokenizerDependencies;
    private readonly functions: FunctionProvider;
    private readonly brackets: Brackets;
    private readonly operators: OperatorDictionary;
    private readonly units: Record<string, any>;

    private preprocessors: Preprocessors = { names: [], actions: [] };

    constructor(functionsProvider: FunctionProvider, operators: OperatorDictionary, units: Record<string, any>) {
        this.functions = functionsProvider
        this.brackets = operators.getBrackets();
        this.operators = operators;
        this.units = units;
    }

    /*
     * Tokenizes the string
     * @param {String} e
     * @returns {Token[]}
     */
    tokenize(e: string, shouldPrepare = false) {
        if (shouldPrepare) {
            e = this.prepareExpression(e);
        }

        let t = new InnerTokenizer(this.functions, this.brackets, this.operators, this.units, e);
        return t.tokenize();
    }

    addPreprocessor(name: string, action: string, order: number, shift_cells: boolean) {
        let names = this.preprocessors.names || [];
        let actions = this.preprocessors.actions || [];
        if ((typeof action !== 'function')) //the person probably forgot to specify a name
            throw new PreprocessorError('Incorrect parameters. Function expected!');
        if (!order) {
            names.push(name);
            actions.push(action);
        }
        else {
            if (shift_cells) {
                names.splice(order, 0, name);
                actions.splice(order, 0, action);
            }
            else {
                names[order] = name;
                actions[order] = action;
            }
        }
    }

    getPreprocessors() {
        let preprocessors: Record<string, any> = {};
        if (this.preprocessors.names?.length )

        for (let i = 0, l = this.preprocessors.names.length; i < l; i++) {
            let name = this.preprocessors.names[i] || '';
            preprocessors[name] = {
                order: i,
                action: this.preprocessors.actions[i]
            };
        }

        return preprocessors;
    }

    removePreprocessor(name: string, shift_cells: boolean) {
        let i = this.preprocessors.names.indexOf(name);
        if (shift_cells) {
            remove(this.preprocessors.names, i);
            remove(this.preprocessors.actions, i);
        }
        else {
            this.preprocessors.names[i] = undefined;
            this.preprocessors.actions[i] = undefined;
        }
    };

    /*
     * Preforms preprocessing on the string. Useful for making early modification before
     * sending to the parser
     * @param {String} e
     */
    prepareExpression(e: string) {
        /*
         * Since variables cannot start with a number, the assumption is made that when this occurs the
         * user intents for this to be a coefficient. The multiplication symbol in then added. The same goes for
         * a side-by-side close and open parenthesis
         */
        e = String(e);
        //apply preprocessors
        for (let i = 0; i < this.preprocessors.actions.length; i++)
            e = this.preprocessors.actions[i]?.call(this, e) || e;

        //e = e.split(' ').join('');//strip empty spaces
        //replace multiple spaces with one space
        e = e.replace(/\s+/g, ' ');

        //only even bother to check if the string contains e. This regex is painfully slow and might need a better solution. e.g. hangs on (0.06/3650))^(365)
        if (/e/gi.test(e)) {
            //replace scientific numbers
            e = e.replace(/-*\d+\.*\d*e\+?-?\d+/gi, x => {
                // @ts-ignore
                return Math2.scientificToDecimal(x);
            });
        }

        //allow omission of multiplication after coefficients
        e = e.replace(Settings.IMPLIED_MULTIPLICATION_REGEX, (match, group1, group2, start, str) => {
            let first = str.charAt(start),
                before = '',
                d = '*';
            if (!first.match(/[+\-\/*]/))
                before = str.charAt(start - 1);
            if (before.match(/[a-z]/i))
                d = '';
            return group1 + d + group2;
        })

        e = e.replace(/([a-z0-9_]+)/gi, (match, a) => {
            if (!Settings.USE_MULTICHARACTER_VARS && !this.functions.getFunctionDescriptor(a)) {
                if (!isNaN(a))
                    return a;
                return a.split('').join('*');
            }
            return a;
        })

        //allow omission of multiplication sign between brackets
        e = e.replace(/\)\(/g, ')*(') || '0';

        //replace x(x+a) with x*(x+a)
        while (true) {
            let e_org = e; //store the original

            e = e.replace(/([a-z0-9_]+)(\()|(\))([a-z0-9]+)/gi, (match, a, b, c, d) => {
                let g1 = a || c,
                    g2 = b || d;

                if (this.functions.getFunctionDescriptor(g1)) //create a passthroughs for functions
                    return g1 + g2;
                return g1 + '*' + g2;
            });

            //if the original equals the replace we're done
            if (e_org === e)
                break;
        }

        return e;
    }


    tree(tokens: Token[]) {
        let Q = [];
        for (let i = 0; i < tokens.length; i++) {
            let e: any = tokens[i];
            //Arrays indicate a new scope so parse that out
            if (Array.isArray(e)) {
                e = this.tree(e);
                //if it's a comma then it's just arguments
                Q.push(e);
                continue;
            }

            if (e.type === Token.OPERATOR) {
                if (e.is_prefix || e.postfix) {
                    //prefixes go to the left, postfix to the right
                    let location = e.is_prefix ? 'left' : 'right';
                    let last = Q.pop();
                    e = new Node(e);
                    e[location] = last;
                    Q.push(e);
                }
                else {
                    e = new Node(e);
                    e.right = Q.pop();
                    e.left = Q.pop();
                    Q.push(e);
                }
            }
            else if (e.type === Token.FUNCTION) {
                e = new Node(e);
                let args = Q.pop();
                e.right = args;
                if (e.value === 'object') {
                    //check if Q has a value
                    let last = Q[Q.length - 1];
                    if (last) {
                        while(last.right) {
                            last = last.right;
                        }
                        last.right = e;
                        continue;
                    }
                }

                Q.push(e);
            }
            else {
                Q.push(new Node(e));
            }
        }

        return Q[0];
    }
}

class InnerTokenizer {
    // dependencies
    private readonly functions: FunctionProvider;
    private readonly brackets: Brackets;
    private readonly operators: OperatorDictionary;
    private readonly units: Record<string, any>;

    private expression: string;

    private readonly scopes: any[];
    private target: any[];
    private depth: number;
    private lpos: number;
    private col: number;
    private readonly tokens: any[];

    constructor(functions: FunctionProvider, brackets: Brackets, operators: OperatorDictionary, units: Record<string, any>, expression: string) {
        this.expression = expression;
        this.functions = functions
        this.brackets = brackets;
        this.operators = operators;
        this.units = units;

        this.tokens = []; //the tokens container
        this.col = 0; //the column position
        this.lpos = 0; //marks beginning of next token
        this.scopes = [this.tokens]; //initiate with the tokens as the highest scope
        this.target = this.tokens; //the target to which the tokens are added. This can swing up or down
        this.depth = 0;

        //cast to String
        let e = String(this.expression);
        //remove multiple white spaces and spaces at beginning and end of string
        e = e.trim().replace(/\s+/g, ' ');
        //remove spaces before and after brackets
        for (let x in this.brackets) {
            let regex = new RegExp(this.brackets[x].is_close ? '\\s+\\' + x : '\\' + x + '\\s+', 'g');
            e = e.replace(regex, x);
        }
        this.expression = e;
    }

    /**
     * Adds a scope to tokens
     * @param {String} scope_type
     * @param {int} column
     * @returns {undefined}
     */
    addScope(scope_type?: string, column?: number) {
        // TODO: need to refactor this mix of array and object
        let new_scope: any = []; //create a new scope
        if (scope_type !== undefined) {
            new_scope.type = scope_type;
        }
        new_scope.column = column; //mark the column of the scope
        this.scopes.push(new_scope); //add it to the list of scopes
        this.target.push(new_scope); //add it to the tokens list since now it's a scope
        this.target = new_scope; //point to it
        this.depth++; //go down one in scope
    }
    /**
     * Goes up in scope by one
     * @returns {undefined}
     */
    goUp() {
        this.scopes.pop(); //remove the scope from the scopes stack
        this.target = this.scopes[--this.depth]; //point the above scope
    }

    /**
     * Extracts all the operators from the expression string starting at postion start_at
     * @param e
     * @param {int} start_at
     * @returns {string}
     */
    get_operator_str(e: string, start_at: number) {
        //mark the end of the operator as the start since we're just going
        //to be walking along the string
        let end = start_at + 1;

        //just keep moving along
        while (this.operators.isOperator(e.charAt(end++))) {
        }

        //remember that we started at one position ahead. The beginning operator is what triggered
        //this function to be called in the first place. String.CharAt is zero based so we now
        //have to correct two places. The initial increment + the extra++ at the end of end during
        //the last iteration.
        return e.substring(start_at, end - 1);
    }

    /**
     * Breaks operator up in to several different operators as defined in operators
     * @param {string} operator_str
     * @returns {string[]}
     */
    chunkify(operator_str: string) {
        let start = this.col - operator_str.length; //start of operator
        let _operators = [];
        let operator = operator_str.charAt(0);
        //grab the largest possible chunks but start at 2 since we already know
        //that the first character is an operator

        let index = start + 1;
        let operatorLength = operator_str.length;

        for (let i = 1; i < operatorLength; i++, index++) {
            let ch = operator_str.charAt(i);
            let o = operator + ch;
            //since the operator now is undefined then the last operator
            //was the largest possible combination.
            if (!this.operators.isOperator(o)) {
                _operators.push(new Token(operator, Token.OPERATOR, index, this.operators.getOperator(operator)));
                operator = ch;
            }
            else
                operator = o;//now the operator is the larger chunk
        }
        //add the last operator
        _operators.push(new Token(operator, Token.OPERATOR, index, this.operators.getOperator(operator)));
        return _operators;
    }

    /**
     * Is used to add a token to the tokens array. Makes sure that no empty token is added
     * @param {int} at
     * @param {String} token
     * @returns {undefined}
     */
    add_token(at?: number, token?: any) {
        //grab the token if we're not supplied one
        if (token === undefined) {
            token = this.expression.substring(this.lpos, at);
        }

        //only add it if it's not an empty string
        if (token in this.units) {
            this.target.push(new Token(token, Token.UNIT, this.lpos));
        }
        else if (token !== '') {
            this.target.push(new Token(token, Token.VARIABLE_OR_LITERAL, this.lpos));
        }
    }

    /**
     * Adds a function to the output
     * @param {String} f
     * @returns {undefined}
     */
    add_function(f: string) {
        this.target.push(new Token(f, Token.FUNCTION, this.lpos));
    }

    /**
     * Tokens are found between operators so this marks the location of where the last token was found
     * @param {int} position
     * @returns {undefined}
     */
    set_last_position(position: number) {
        this.lpos = position + 1;
    }

    /**
     * When a operator is found and added, especially a combo operator, then the column location
     * has to be adjusted to the end of the operator
     * @returns {undefined}
     */
    adjust_column_position(operator_str: string) {
        this.lpos = this.lpos + operator_str.length - 2;
        this.col = this.lpos - 1;
    }

    /**
     * Tokenizes the string
     * @param {String} e
     * @returns {Token[]}
     */
    tokenize() {
        let e = this.expression;

        let L = e.length; //expression length
        let open_brackets: [Bracket, number][] = [];
        let has_space = false; //marks if an open space character was found
        let SPACE = ' ';
        let EMPTY_STRING = '';
        let COMMA = ',';
        let MINUS = '-';
        let MULT = '*';
        //Possible source of bug. Review
        /*
         //gets the next space
         var next_space = function(from) {
         for (var i=from; i<L; i++) {
         if (e.charAt(i) === ' ')
         return i;
         }

         return L; //assume the end of the string instead
         };
         */




        for (; this.col < L; this.col++) {
            let ch = e.charAt(this.col);
            if (this.operators.isOperator(ch)) {
                this.add_token(this.col);
                //is the last token numeric?
                let last_token_is_numeric = this.target[0] && isNumber(this.target[0]);
                //is this character multiplication?
                let is_multiplication = last_token_is_numeric && ch === MULT;
                //if we're in a new scope then go up by one but if the space
                //is right befor an operator then it makes no sense to go up in scope
                //consider sin -x. The last position = current position at the minus sign
                //this means that we're going for sin(x) -x which is wrong
                //Ignore comma since comma is still part of the existing scope.
                if (has_space && this.lpos < this.col && !(ch === COMMA || is_multiplication)) {
                    has_space = false;
                    this.goUp();
                }
                //mark the last position that a
                this.set_last_position(this.col + 1);
                let operator_str = this.get_operator_str(e, this.col);

                this.adjust_column_position(operator_str);
                this.target.push.apply(this.target, this.chunkify(operator_str));
            }
            else if (ch in this.brackets) {
                let bracket = this.brackets[ch];

                if (bracket.is_open) {
                    //mark the bracket
                    open_brackets.push([bracket, this.lpos]);
                    let f = e.substring(this.lpos, this.col);
                    if (this.functions.getFunctionDescriptor(f)) {
                        this.add_function(f);
                    }
                    else if (f !== '') {
                        //assume multiplication
                        //TODO: Add the multiplication to stack
                        this.target.push(new Token(f, Token.VARIABLE_OR_LITERAL, this.lpos));
                    }
                    //go down one in scope
                    this.addScope(bracket.maps_to, this.col);
                }
                else if (bracket.is_close) {
                    //get the matching bracket
                    let pair = open_brackets.pop();
                    //throw errors accordingly
                    //missing open bracket
                    if (!pair)
                        throw new ParityError('Missing open bracket for bracket at: ' + (this.col + 1));
                    //incorrect pair
                    else if (pair[0].id !== bracket.id - 1)
                        throw new ParityError('Parity error');

                    this.add_token(this.col);
                    this.goUp();
                }
                this.set_last_position(this.col);
            }
            else if (ch === SPACE) {
                let prev = e.substring(this.lpos, this.col); //look back
                let nxt = e.charAt(this.col + 1); //look forward
                if (has_space) {

                    if (this.operators.isOperator(prev)) {
                        this.target.push(new Token(prev, Token.OPERATOR, this.col, this.operators.getOperator(prev)));
                    }
                    else {
                        this.add_token(undefined, prev);
                        //we're at the closing space
                        this.goUp(); //go up in scope if we're at a space

                        //assume multiplication if it's not an operator except for minus
                        let is_operator = this.operators.isOperator(nxt);

                        if ((is_operator && this.operators.getOperator(nxt).value === MINUS) || !is_operator) {
                            this.target.push(new Token(MULT, Token.OPERATOR, this.col, this.operators.getOperator(MULT)));
                        }
                    }
                    has_space = false; //remove the space
                }
                else {
                    //we're at the closing space
                    //check if it's a function
                    let f = e.substring(this.lpos, this.col);

                    if (this.functions.getFunctionDescriptor(f)) {
                        //there's no need to go up in scope if the next character is an operator
                        has_space = true; //mark that a space was found
                        this.add_function(f);
                        this.addScope();
                    }
                    else if (this.operators.isOperator(f)) {
                        this.target.push(new Token(f, Token.OPERATOR, this.col, this.operators.getOperator(f)));
                    }
                    else {
                        this.add_token(undefined, f);
                        //peek ahead to the next character
                        let nxt = e.charAt(this.col + 1);

                        //If it's a number then add the multiplication operator to the stack but make sure that the next character
                        //is not an operator

                        if (prev !== EMPTY_STRING && nxt !== EMPTY_STRING && !this.operators.isOperator(prev) && !this.operators.isOperator(nxt))
                            this.target.push(new Token(MULT, Token.OPERATOR, this.col, this.operators.getOperator(MULT)));
                    }
                    //Possible source of bug. Review
                    /*
                     //space can mean multiplication so add the symbol if the is encountered
                     if (/\d+|\d+\.?\d*e[\+\-]*\d+/i.test(f)) {
                     var next = e.charAt(col+1);
                     var next_is_operator = next in operators;
                     var ns = next_space(col+1);
                     var next_word = e.substring(col+1, ns);
                     //the next can either be a prefix operator or no operator
                     if ((next_is_operator && operators[next].prefix) || !(next_is_operator || next_word in operators))
                     this.target.push(new Token('*', Token.OPERATOR, col));
                     }
                     */
                }
                this.set_last_position(this.col); //mark this location
            }
        }
        //check that all brackets were closed
        if (open_brackets.length) {
            const b = open_brackets.pop();
            throw new ParityError('Missing closed bracket for bracket at ' + (b ? b[1] + 1 : 'undefined'));
        }
        //add the last token
        this.add_token(this.col);

        return this.tokens;
    }
}