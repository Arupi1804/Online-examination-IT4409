import { useState, type ComponentProps } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';

export function PasswordField(
  props: Omit<ComponentProps<typeof FormField>, 'type' | 'endAdornment'>,
) {
  const [visible, setVisible] = useState(false);
  return (
    <FormField
      {...props}
      type={visible ? 'text' : 'password'}
      endAdornment={
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:bg-transparent"
          aria-label={`${visible ? 'Ẩn' : 'Hiện'} ${props.label.toLowerCase()}`}
          aria-pressed={visible}
          disabled={props.disabled}
          onClick={() => setVisible(!visible)}
        >
          {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </Button>
      }
    />
  );
}
