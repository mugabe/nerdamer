import {Settings} from '../Settings';
import {Build} from './Build';
import {text} from '../Core/Text';
import {LaTeX} from '../LaTeX/LaTeX';
import {block, isFraction, isNumericSymbol, isSymbol, isVector} from '../Core/Utils';
import {subtract} from '../Core/functions';
import {parse, evaluate} from '../Core/parse';
import {expand} from '../Core/functions/math/expand';

// noinspection JSUnusedGlobalSymbols
/**
 * This is what nerdamer returns. It's sort of a wrapper around the symbol class and
 * provides the user with some useful functions. If you want to provide the user with extra
 * library functions then add them to this class's prototype.
 * @param {Symbol} symbol
 * @returns {Expression} wraps around the Symbol class
 */

export class Expression {
    /** @deprecated */
    static $EXPRESSIONS;
    /** @deprecated */
    $variables;
    symbol;

    constructor(symbol) {
        //we don't want arrays wrapped
        this.symbol = symbol;
    }

    /**
     * Returns stored expression at index. For first index use 1 not 0.
     * @param {number | string} expression_number
     * @param {boolean} asType
     */
    static getExpression(expression_number, asType = false) {
        if (expression_number === 'last' || !expression_number)
            expression_number = Expression.$EXPRESSIONS.length;

        if (expression_number === 'first')
            expression_number = 1;

        let index = expression_number - 1,
            expression = Expression.$EXPRESSIONS[index];

        return expression ? new Expression(expression) : expression;
    }

    /**
     * Returns the text representation of the expression
     * @param {String} opt - option of formatting numbers
     * @param {Number} n The number of significant figures
     * @returns {String}
     */
    text(opt = 'decimals', n = 0) {
        n = n || 19;
        opt = opt || 'decimals';
        if (this.symbol.text_)
            return this.symbol.text_(opt);

        return text(this.symbol, opt, undefined, n);
    }

    /**
     * Returns the latex representation of the expression
     * @param {String} option - option for formatting numbers
     * @returns {String}
     */
    latex(option) {
        if (this.symbol.latex)
            return this.symbol.latex(option);
        return LaTeX.latex(this.symbol, option);
    }

    valueOf() {
        return this.symbol.valueOf();
    }

    /**
     * Evaluates the expression and tries to reduce it to a number if possible.
     * If an argument is given in the form of %{integer} it will evaluate that expression.
     * Other than that it will just use it's own text and reparse
     * @returns {Expression}
     */
    evaluate() {

        // Don't evaluate an empty vector
        if (isVector(this.symbol) && this.symbol.dimensions() === 0) {
            return this;
        }

        let first_arg = arguments[0], expression, idx = 1;

        //Enable getting of expressions using the % so for example %1 should get the first expression
        if (typeof first_arg === 'string') {
            expression = (first_arg.charAt(0) === '%') ? Expression.getExpression(first_arg.substr(1)).text() : first_arg;
        }
        else if (first_arg instanceof Expression || isSymbol(first_arg)) {
            expression = first_arg.text();
        }
        else {
            expression = this.symbol.text();
            idx--;
        }

        let subs = arguments[idx] || {};

        return new Expression(block('PARSE2NUMBER', function () {
            return parse(expression, subs);
        }, true, this));
    }

    /**
     * Converts a symbol to a JS function. Pass in an array of variables to use that order instead of
     * the default alphabetical order
     * @param vars {Array}
     */
    buildFunction(vars) {
        return Build.build(this.symbol, vars);
    }

    /**
     * Checks to see if the expression is just a plain old number
     * @returns {boolean}
     */
    isNumber() {
        return isNumericSymbol(this.symbol);
    }

    /**
     * Checks to see if the expression is infinity
     * @returns {boolean}
     */
    isInfinity() {
        return Math.abs(this.symbol.multiplier) === Infinity;
    }

    /**
     * Checks to see if the expression contains imaginary numbers
     * @returns {boolean}
     */
    isImaginary() {
        return evaluate(parse(this.symbol)).isImaginary();
    }

    /**
     * Returns all the variables in the expression
     * @returns {Array}
     */
    variables() {
        return this.$variables(this.symbol);
    }

    toString() {
        try {
            if (Array.isArray(this.symbol))
                return '[' + this.symbol.toString() + ']';
            return this.symbol.toString();
        }
        catch(e) {
            return '';
        }
    }

    //forces the symbol to be returned as a decimal
    toDecimal(prec) {
        Settings.precision = prec;
        let dec = text(this.symbol, 'decimals');
        Settings.precision = undefined;
        return dec;
    }

    //checks to see if the expression is a fraction
    isFraction() {
        return isFraction(this.symbol);
    }

    //checks to see if the symbol is a multivariate polynomial
    isPolynomial() {
        return this.symbol.isPoly();
    }

    //performs a substitution
    sub(symbol, for_symbol) {
        return new Expression(this.symbol.sub(parse(symbol), parse(for_symbol)));
    }

    operation(otype, symbol) {
        if (isExpression(symbol)) {
            symbol = symbol.symbol;
        }
        else if (!isSymbol(symbol)) {
            symbol = parse(symbol);
        }

        return new Expression(this.$getAction(otype)(this.symbol.clone(), symbol.clone()));
    }

    add(symbol) {
        return this.operation('add', symbol);
    }

    subtract(symbol) {
        return this.operation('subtract', symbol);
    }

    multiply(symbol) {
        return this.operation('multiply', symbol);
    }

    divide(symbol) {
        return this.operation('divide', symbol);
    }

    pow(symbol) {
        return this.operation('pow', symbol);
    }

    expand() {
        return new Expression(expand(this.symbol));
    }

    each(callback, i) {
        if (this.symbol.each)
            this.symbol.each(callback, i);
        else if (Array.isArray(this.symbol)) {
            for (let i = 0; i < this.symbol.length; i++)
                callback.call(this.symbol, this.symbol[i], i);
        }
        else
            callback.call(this.symbol);
    }

    eq(value) {
        if (!isSymbol(value))
            value = parse(value);
        try {
            let d = subtract(this.symbol.clone(), value);
            return d.equals(0);
        }
        catch(e) {
            return false;
        }
    }

    lt(value) {
        if (!isSymbol(value))
            value = parse(value);
        try {
            let d = evaluate(subtract(this.symbol.clone(), value));
            return d.lessThan(0);
        }
        catch(e) {
            return false;
        }
    }

    gt(value) {
        if (!isSymbol(value))
            value = parse(value);
        try {
            let d = evaluate(subtract(this.symbol.clone(), value));
            return d.greaterThan(0);
        }
        catch(e) {
            return false;
        }
    }

    gte(value) {
        return this.gt(value) || this.eq(value);
    }

    lte(value) {
        return this.lt(value) || this.eq(value);
    }

    numerator() {
        return new Expression(this.symbol.getNum());
    }

    denominator() {
        return new Expression(this.symbol.getDenom());
    }

    hasFunction(f) {
        return this.symbol.containsFunction(f);
    }

    contains(variable) {
        return this.symbol.contains(variable);
    }

    toTeX(option) {
        return this.latex(option);
    }
}

