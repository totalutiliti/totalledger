'use client';

import {
  forwardRef,
  useCallback,
  useRef,
  useImperativeHandle,
  type KeyboardEvent,
  type ChangeEvent,
  type FocusEvent,
} from 'react';

export interface TimeInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  title?: string;
  className?: string;
  /** Grid position for arrow-key navigation */
  'data-row'?: number;
  'data-col'?: number;
}

/**
 * Input de horario HH:MM com:
 * - Auto-format: digitar "0725" vira "07:25"
 * - Navegacao por setas (←→↑↓) entre campos adjacentes (tipo planilha)
 * - Backspace inteligente: apaga o ":" junto quando necessario
 */
const TimeInput = forwardRef<HTMLInputElement, TimeInputProps>(
  function TimeInput(props, ref) {
    const {
      value,
      onChange,
      placeholder = '--:--',
      title,
      className = '',
      ...rest
    } = props;

    const inputRef = useRef<HTMLInputElement>(null);
    useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);

    /**
     * Formata entrada do usuario inserindo ":" automaticamente.
     * Aceita apenas digitos; o ":" e inserido apos 2 digitos.
     */
    const handleChange = useCallback(
      (e: ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value;

        // Extrair somente digitos
        const digits = raw.replace(/\D/g, '').slice(0, 4);

        let formatted: string;
        if (digits.length <= 2) {
          formatted = digits;
        } else {
          formatted = `${digits.slice(0, 2)}:${digits.slice(2)}`;
        }

        onChange(formatted);
      },
      [onChange],
    );

    /**
     * No blur, valida e normaliza o horario.
     * - "7" → "07:00" (interpreta como hora cheia)
     * - "725" → "07:25"
     * - "0725" → "07:25"
     * - Valores invalidos → limpa
     */
    const handleBlur = useCallback(
      (_e: FocusEvent<HTMLInputElement>) => {
        if (!value || value.trim() === '') return;

        const digits = value.replace(/\D/g, '');
        if (digits.length === 0) {
          onChange('');
          return;
        }

        let h: number;
        let m: number;

        if (digits.length <= 2) {
          // "7" → 07:00, "12" → 12:00
          h = parseInt(digits, 10);
          m = 0;
        } else if (digits.length === 3) {
          // "725" → 07:25
          h = parseInt(digits.slice(0, 1), 10);
          m = parseInt(digits.slice(1), 10);
        } else {
          // "0725" → 07:25
          h = parseInt(digits.slice(0, 2), 10);
          m = parseInt(digits.slice(2, 4), 10);
        }

        if (isNaN(h) || isNaN(m) || h > 23 || m > 59) {
          // Invalido — manter o que o usuario digitou (nao apagar)
          return;
        }

        const formatted = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        onChange(formatted);
      },
      [value, onChange],
    );

    /**
     * Navegacao por setas entre campos da grade.
     * Usa data-row / data-col para encontrar o proximo campo.
     */
    const handleKeyDown = useCallback(
      (e: KeyboardEvent<HTMLInputElement>) => {
        const input = inputRef.current;
        if (!input) return;

        const row = Number(input.dataset.row);
        const col = Number(input.dataset.col);

        // Container de navegacao: a tabela mais proxima
        const table = input.closest('table');
        if (!table) return;

        let targetRow = row;
        let targetCol = col;
        let shouldNavigate = false;

        /**
         * Encontra o proximo input navegavel na direcao horizontal.
         * Pula celulas vazias de hora extra e vai para a primeira
         * celula preenchida (ou col 0) da proxima linha.
         */
        const findNextHorizontal = (
          fromRow: number,
          fromCol: number,
          direction: 1 | -1,
        ): HTMLInputElement | null => {
          let r = fromRow;
          let c = fromCol + direction;

          // Tentar na mesma linha primeiro
          while (c >= 0 && c <= 5) {
            const candidate = table.querySelector<HTMLInputElement>(
              `input[data-row="${r}"][data-col="${c}"]`,
            );
            if (candidate) {
              // Se o campo tem valor OU estamos voltando (esquerda), navega
              if (direction === -1 || candidate.value.trim() !== '') {
                return candidate;
              }
              // Campo vazio na direcao direita: pular para proxima linha
              break;
            }
            c += direction;
          }

          // Nao achou na mesma linha — ir para outra linha
          if (direction === 1) {
            // Proxima linha, primeira coluna (col 0)
            return table.querySelector<HTMLInputElement>(
              `input[data-row="${r + 1}"][data-col="0"]`,
            );
          } else {
            // Linha anterior, ultima celula preenchida
            const prevRow = r - 1;
            for (let cc = 5; cc >= 0; cc--) {
              const candidate = table.querySelector<HTMLInputElement>(
                `input[data-row="${prevRow}"][data-col="${cc}"]`,
              );
              if (candidate && candidate.value.trim() !== '') return candidate;
            }
            // Fallback: col 3 (saidaTarde) da linha anterior
            return table.querySelector<HTMLInputElement>(
              `input[data-row="${prevRow}"][data-col="3"]`,
            );
          }
        };

        switch (e.key) {
          case 'ArrowUp':
            targetRow = row - 1;
            shouldNavigate = true;
            e.preventDefault();
            break;

          case 'ArrowDown':
            targetRow = row + 1;
            shouldNavigate = true;
            e.preventDefault();
            break;

          case 'ArrowLeft':
            // Navega para a esquerda so se o cursor esta no inicio
            if (input.selectionStart === 0 && input.selectionEnd === 0) {
              const prev = findNextHorizontal(row, col, -1);
              if (prev) {
                prev.focus();
                requestAnimationFrame(() => prev.select());
              }
              e.preventDefault();
              return;
            }
            break;

          case 'ArrowRight':
            // Navega para a direita so se o cursor esta no fim
            if (input.selectionStart === input.value.length) {
              const next = findNextHorizontal(row, col, 1);
              if (next) {
                next.focus();
                requestAnimationFrame(() => next.select());
              }
              e.preventDefault();
              return;
            }
            break;

          case 'Tab': {
            // Tab: mesma logica — pula campos vazios de extra
            const next = findNextHorizontal(row, col, e.shiftKey ? -1 : 1);
            if (next) {
              next.focus();
              requestAnimationFrame(() => next.select());
              e.preventDefault();
              return;
            }
            break;
          }

          case 'Enter': {
            // Enter: proxima linha, mesma coluna
            targetRow = row + 1;
            shouldNavigate = true;
            e.preventDefault();
            break;
          }

          default:
            break;
        }

        if (shouldNavigate) {
          const target = table.querySelector<HTMLInputElement>(
            `input[data-row="${targetRow}"][data-col="${targetCol}"]`,
          );
          if (target) {
            target.focus();
            // Selecionar tudo ao navegar
            requestAnimationFrame(() => target.select());
          }
        }
      },
      [],
    );

    return (
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        maxLength={5}
        value={value}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onFocus={(e) => e.target.select()}
        placeholder={placeholder}
        title={title}
        className={className}
        autoComplete="off"
        {...rest}
      />
    );
  },
);

export default TimeInput;
