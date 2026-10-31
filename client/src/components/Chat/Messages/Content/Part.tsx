import { memo } from 'react';
import {
  Tools,
  Constants,
  ContentTypes,
  ToolCallTypes,
  imageGenTools,
  isImageVisionTool,
} from 'librechat-data-provider';
import type { TMessageContentParts, TAttachment } from 'librechat-data-provider';
import {
  ImageGen,
  ExecuteCode,
  AgentUpdate,
  EmptyText,
  Summary,
  Text,
  SkillCall,
  ReadFileCall,
  BashCall,
  SubagentCall,
} from './Parts';
import Reasoning from './Parts/Reasoning';
import { ErrorMessage } from './MessageContent';
import RetrievalCall from './RetrievalCall';
import KnowledgeRetrievalCall from './KnowledgeRetrievalCall';
import FileParseCall from './FileParseCall';
import { getCachedPreview } from '~/utils';
import AgentHandoff from './AgentHandoff';
import CodeAnalyze from './CodeAnalyze';
import { isBashProgrammaticToolCall } from './routing';
import Container from './Container';
import WebSearch from './WebSearch';
import ToolCall from './ToolCall';
import Image from './Image';
import { SANSUO_FILE_PARSE_TOOL, SANSUO_KNOWLEDGE_SEARCH_TOOL } from '~/utils/sansuoMode';

type PartProps = {
  part?: TMessageContentParts;
  isLast?: boolean;
  isSubmitting: boolean;
  showCursor: boolean;
  isCreatedByUser: boolean;
  attachments?: TAttachment[];
  hideAttachments?: boolean;
};

const Part = memo(function Part({
  part,
  isSubmitting,
  attachments,
  isLast,
  showCursor,
  isCreatedByUser,
  hideAttachments,
}: PartProps) {
  if (!part) {
    return null;
  }

  if (part.type === ContentTypes.ERROR) {
    return (
      <ErrorMessage
        text={
          part[ContentTypes.ERROR] ??
          (typeof part[ContentTypes.TEXT] === 'string'
            ? part[ContentTypes.TEXT]
            : part.text?.value) ??
          ''
        }
        className="my-2"
      />
    );
  } else if (part.type === ContentTypes.AGENT_UPDATE) {
    return (
      <>
        <AgentUpdate currentAgentId={part[ContentTypes.AGENT_UPDATE]?.agentId} />
        {isLast && showCursor && (
          <Container>
            <EmptyText />
          </Container>
        )}
      </>
    );
  } else if (part.type === ContentTypes.TEXT) {
    const text = typeof part.text === 'string' ? part.text : part.text?.value;

    if (typeof text !== 'string') {
      return null;
    }
    if (text.length === 0 && isLast && showCursor && !isCreatedByUser) {
      return (
        <Container>
          <EmptyText />
        </Container>
      );
    }
    if (part.tool_call_ids != null && !text) {
      return null;
    }
    if (text.length > 0 && /^\s*$/.test(text)) {
      if (isLast && showCursor) {
        return (
          <Container>
            <EmptyText />
          </Container>
        );
      }
      if (!isLast) {
        return null;
      }
    }
    return (
      <Container>
        <Text text={text} isCreatedByUser={isCreatedByUser} showCursor={showCursor} />
      </Container>
    );
  } else if (part.type === ContentTypes.THINK) {
    const thinking = part[ContentTypes.THINK] ?? part.think;
    if (typeof thinking !== 'string' || thinking.trim().length === 0) {
      return null;
    }
    return <Reasoning reasoning={thinking} isLast={Boolean(isLast && showCursor)} />;
  } else if (part.type === ContentTypes.SUMMARY) {
    return (
      <Summary
        content={part.content}
        model={part.model}
        provider={part.provider}
        tokenCount={part.tokenCount}
        summarizing={part.summarizing}
      />
    );
  } else if (part.type === ContentTypes.TOOL_CALL) {
    const toolCall = part[ContentTypes.TOOL_CALL];
    if (!toolCall) {
      return null;
    }

    const visibleAttachments = hideAttachments ? undefined : attachments;
    const isToolCall =
      'args' in toolCall && (!toolCall.type || toolCall.type === ToolCallTypes.TOOL_CALL);

    if (isToolCall && toolCall.name === SANSUO_KNOWLEDGE_SEARCH_TOOL) {
      return (
        <KnowledgeRetrievalCall
          progress={(toolCall as typeof toolCall & { progress?: number }).progress ?? 0.1}
          status={
            (toolCall as typeof toolCall & { status?: 'searching' | 'completed' | 'failed' }).status
          }
        />
      );
    } else if (isToolCall && toolCall.name === SANSUO_FILE_PARSE_TOOL) {
      return (
        <FileParseCall
          progress={(toolCall as typeof toolCall & { progress?: number }).progress ?? 0.1}
          status={
            (toolCall as typeof toolCall & { status?: 'parsing' | 'completed' | 'failed' }).status
          }
        />
      );
    } else if (isToolCall && toolCall.name === Constants.SUBAGENT) {
      return (
        <SubagentCall
          toolCallId={toolCall.id ?? ''}
          initialProgress={toolCall.progress ?? 0.1}
          isSubmitting={isSubmitting}
          args={toolCall.args}
          output={toolCall.output}
          attachments={visibleAttachments}
          persistedContent={
            (toolCall as typeof toolCall & { subagent_content?: TMessageContentParts[] })
              .subagent_content
          }
          hideAttachments={hideAttachments}
        />
      );
    } else if (isToolCall && toolCall.name === Tools.skill) {
      return (
        <SkillCall
          initialProgress={toolCall.progress ?? 0.1}
          isSubmitting={isSubmitting}
          args={toolCall.args}
          output={toolCall.output ?? ''}
          attachments={visibleAttachments}
          hideAttachments={hideAttachments}
        />
      );
    } else if (isToolCall && toolCall.name === Tools.read_file) {
      return (
        <ReadFileCall
          initialProgress={toolCall.progress ?? 0.1}
          isSubmitting={isSubmitting}
          args={toolCall.args}
          output={toolCall.output ?? ''}
          attachments={visibleAttachments}
          hideAttachments={hideAttachments}
        />
      );
    } else if (
      isToolCall &&
      (toolCall.name === Tools.bash_tool ||
        isBashProgrammaticToolCall(toolCall.name, toolCall.args))
    ) {
      return (
        <BashCall
          initialProgress={toolCall.progress ?? 0.1}
          isSubmitting={isSubmitting}
          args={toolCall.args}
          output={toolCall.output ?? ''}
          attachments={visibleAttachments}
          commandField={toolCall.name === Tools.bash_tool ? 'command' : 'code'}
          hideAttachments={hideAttachments}
        />
      );
    } else if (
      isToolCall &&
      (toolCall.name === Tools.execute_code ||
        toolCall.name === Constants.PROGRAMMATIC_TOOL_CALLING)
    ) {
      return (
        <ExecuteCode
          attachments={visibleAttachments}
          isSubmitting={isSubmitting}
          output={toolCall.output ?? ''}
          initialProgress={toolCall.progress ?? 0.1}
          args={toolCall.args}
          hideAttachments={hideAttachments}
        />
      );
    } else if (
      isToolCall &&
      (toolCall.name === 'image_gen_oai' ||
        toolCall.name === 'image_edit_oai' ||
        toolCall.name === 'gemini_image_gen')
    ) {
      return (
        <ImageGen
          initialProgress={toolCall.progress ?? 0.1}
          isSubmitting={isSubmitting}
          toolName={toolCall.name}
          args={typeof toolCall.args === 'string' ? toolCall.args : ''}
          output={toolCall.output ?? ''}
          attachments={visibleAttachments}
          hideAttachments={hideAttachments}
        />
      );
    } else if (isToolCall && toolCall.name === Tools.web_search) {
      return (
        <WebSearch
          output={toolCall.output ?? ''}
          initialProgress={toolCall.progress ?? 0.1}
          isSubmitting={isSubmitting}
          attachments={visibleAttachments}
          isLast={isLast}
        />
      );
    } else if (
      isToolCall &&
      (toolCall.name === Tools.file_search || toolCall.name === Tools.retrieval)
    ) {
      return (
        <RetrievalCall
          initialProgress={toolCall.progress ?? 0.1}
          isSubmitting={isSubmitting}
          output={toolCall.output ?? undefined}
          attachments={visibleAttachments}
        />
      );
    } else if (isToolCall && toolCall.name?.startsWith(Constants.LC_TRANSFER_TO_)) {
      return <AgentHandoff args={toolCall.args ?? ''} name={toolCall.name || ''} />;
    } else if (isToolCall) {
      return (
        <ToolCall
          args={toolCall.args ?? ''}
          name={toolCall.name || ''}
          output={toolCall.output ?? ''}
          initialProgress={toolCall.progress ?? 0.1}
          isSubmitting={isSubmitting}
          attachments={visibleAttachments}
          hideAttachments={hideAttachments}
          auth={toolCall.auth}
          isLast={isLast}
        />
      );
    } else if (toolCall.type === ToolCallTypes.CODE_INTERPRETER) {
      const codeInterpreter = toolCall[ToolCallTypes.CODE_INTERPRETER];
      return (
        <CodeAnalyze
          initialProgress={toolCall.progress ?? 0.1}
          code={codeInterpreter.input}
          outputs={codeInterpreter.outputs ?? []}
        />
      );
    } else if (
      toolCall.type === ToolCallTypes.RETRIEVAL ||
      toolCall.type === ToolCallTypes.FILE_SEARCH
    ) {
      return (
        <RetrievalCall
          initialProgress={toolCall.progress ?? 0.1}
          isSubmitting={isSubmitting}
          output={(toolCall as { output?: string }).output}
          attachments={visibleAttachments}
        />
      );
    } else if (
      toolCall.type === ToolCallTypes.FUNCTION &&
      ToolCallTypes.FUNCTION in toolCall &&
      imageGenTools.has(toolCall.function.name)
    ) {
      return (
        <ImageGen
          initialProgress={toolCall.progress ?? 0.1}
          args={toolCall.function.arguments as string}
          isSubmitting={isSubmitting}
          toolName={toolCall.function.name}
          output={toolCall.function.output ?? ''}
          attachments={visibleAttachments}
          hideAttachments={hideAttachments}
        />
      );
    } else if (toolCall.type === ToolCallTypes.FUNCTION && ToolCallTypes.FUNCTION in toolCall) {
      if (isImageVisionTool(toolCall)) {
        if (isSubmitting && showCursor) {
          return (
            <Container>
              <Text text={''} isCreatedByUser={isCreatedByUser} showCursor={showCursor} />
            </Container>
          );
        }
        return null;
      }

      return (
        <ToolCall
          initialProgress={toolCall.progress ?? 0.1}
          isSubmitting={isSubmitting}
          args={toolCall.function.arguments as string}
          name={toolCall.function.name}
          output={toolCall.function.output}
          attachments={visibleAttachments}
          hideAttachments={hideAttachments}
          isLast={isLast}
        />
      );
    }
  } else if (part.type === ContentTypes.IMAGE_FILE) {
    const imageFile = part[ContentTypes.IMAGE_FILE];
    const cached = imageFile.file_id ? getCachedPreview(imageFile.file_id) : undefined;
    return (
      <Image
        imagePath={cached ?? imageFile.filepath}
        altText={imageFile.filename ?? 'Uploaded Image'}
        width={imageFile.width}
        height={imageFile.height}
      />
    );
  }

  return null;
});
Part.displayName = 'Part';

export default Part;
