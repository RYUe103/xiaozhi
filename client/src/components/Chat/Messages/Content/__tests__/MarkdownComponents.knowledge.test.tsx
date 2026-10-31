import React from 'react';
import { render, screen } from '@testing-library/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import supersub from 'remark-supersub';
import {
  getKnowledgeCitationNumber,
  getReactNodeText,
  KnowledgeCitation,
} from '../MarkdownComponents';

describe('knowledge Markdown labels', () => {
  test('extracts visible text from nested React nodes without object serialization', () => {
    const children = [
      <span key="open">[</span>,
      <strong key="number">1</strong>,
      <span key="close">]</span>,
    ];

    const text = getReactNodeText(children);

    expect(text).toBe('[1]');
    expect(text).not.toContain('[object Object]');
  });

  test('preserves nested source filename and page text', () => {
    const filename = '管道等级表';
    const extension = '.pdf';
    const page = '（第 12 页）';
    const children = (
      <>
        <span>{filename}</span>
        <em>{extension}</em>
        <span>{page}</span>
      </>
    );

    expect(getReactNodeText(children)).toBe(`${filename}${extension}${page}`);
  });

  test('ignores non-visible values instead of stringifying them', () => {
    const source = '来源';
    expect(getReactNodeText([null, false, undefined, <span key="text">{source}</span>])).toBe(
      source,
    );
  });

  test('renders one orange bracketed citation without duplicating its number', () => {
    render(
      <KnowledgeCitation href="https://kb.example/source-1">
        <span>[</span>
        <strong>1</strong>
        <span>]</span>
      </KnowledgeCitation>,
    );

    const citation = screen.getByRole('link', { name: '[1]' });
    expect(citation).toHaveTextContent('[1]');
    expect(citation).not.toHaveTextContent('[111]');
    expect(citation).toHaveClass('!text-[#c2410c]');
    expect(citation.closest('sup')).toHaveClass('text-[#c2410c]');
  });

  test('normalizes the repeated citation children observed in the production renderer', () => {
    expect(
      getKnowledgeCitationNumber([
        <span key="first">10</span>,
        <span key="second">10</span>,
        <span key="third">10</span>,
      ]),
    ).toBe('10');

    render(
      <KnowledgeCitation href="https://kb.example/source-1">
        <span>1</span>
        <span>1</span>
        <span>1</span>
      </KnowledgeCitation>,
    );

    expect(screen.getByRole('link', { name: '[1]' })).toHaveTextContent('[1]');
    expect(screen.getByRole('link', { name: '[1]' })).not.toHaveTextContent('[111]');
  });

  test('renders a knowledge citation once through the real Markdown plugins', () => {
    const content = '结论[\\[1\\]](<https://kb.example/source-1> "sansuo-knowledge-citation")。';

    render(
      <ReactMarkdown
        remarkPlugins={[supersub, remarkGfm]}
        components={{
          a: ({ href = '', children }) => (
            <KnowledgeCitation href={href}>{children}</KnowledgeCitation>
          ),
        }}
      >
        {content}
      </ReactMarkdown>,
    );

    expect(screen.getByRole('link')).toHaveTextContent('[1]');
    expect(screen.getByRole('link')).not.toHaveTextContent('[111]');
  });
});
