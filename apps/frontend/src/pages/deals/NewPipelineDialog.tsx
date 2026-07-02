import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createPipeline } from "@/lib/pipelines-api";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface NewPipelineDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (pipelineId: string) => void;
}

export function NewPipelineDialog({ open, onClose, onCreated }: NewPipelineDialogProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");

  const mutation = useMutation({
    mutationFn: () => createPipeline(name.trim()),
    onSuccess: (pipeline) => {
      queryClient.invalidateQueries({ queryKey: ["pipelines"] });
      setName("");
      onCreated(pipeline.id);
      onClose();
    },
  });

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>Novo funil</DialogTitle>
      </DialogHeader>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="pipeline-name">Nome *</Label>
          <Input id="pipeline-name" value={name} onChange={(e) => setName(e.target.value)} required />
          <p className="text-xs text-muted-foreground">
            Criado com as fases por omissão: Novo, Em negociação, Ganho, Perdido.
          </p>
        </div>
        {mutation.isError && (
          <p className="text-sm text-red-600">Não foi possível criar o funil. Tenta novamente.</p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={mutation.isPending || !name.trim()}>
            {mutation.isPending ? "A criar..." : "Criar funil"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
